import type { StationConfig } from "../domain.ts";
import {
  scoreConfidence,
  type InspectionOutcome,
  type InspectionRequest,
  type Inspector,
} from "./inspector.ts";

/**
 * An inspector backed by a real inference service.
 *
 * This is the adapter a TAO-trained model behind Triton, or a DeepStream
 * pipeline publishing detections, plugs into. The engine keeps asking the same
 * question and keeps applying the same factory rules; only the answer's source
 * moves off this machine.
 *
 * Three properties matter more than throughput here:
 *
 * **It never blocks the line.** A tick cannot wait on a network call, so the
 * service is polled asynchronously and the inspector answers from the newest
 * result it holds. A camera that has not spoken yet reports nothing rather than
 * guessing — the same rule `RecordedInspector` follows.
 *
 * **It never invents a detection.** A timeout, a 500, or a malformed body is a
 * *miss*, counted and visible, not a silent pass. A vision system that fails
 * open is worse than no vision system, because the plant stops watching.
 *
 * **It reports its own confidence.** Where the service returns a score, that
 * score is passed through untouched. Where it does not, the shared
 * `scoreConfidence` scale is used so a probability means the same thing on
 * every gate.
 */

/**
 * What an inference service is expected to return.
 *
 * Deliberately the shape a TAO detection or classification head produces after
 * post-processing: a list of labelled boxes with scores. Mapping those onto the
 * defects the twin knows about is this adapter's job, not the model's.
 */
export interface ServiceDetection {
  /** Class name as the model was trained: SCRATCH, DENT, OK, … */
  readonly label: string;
  readonly score: number;
  readonly box?: readonly [number, number, number, number];
}

export interface ServiceResponse {
  readonly productId: string;
  readonly stationId: string;
  readonly detections: readonly ServiceDetection[];
  /** Optional: the model and version that produced this, for the audit trail. */
  readonly model?: string;
}

export interface ServiceInspectorOptions {
  /** Base URL of the inference service, e.g. http://localhost:8000 */
  readonly endpoint: string;
  /** Ignore detections below this score. Set from a validated PR curve, never guessed. */
  readonly threshold: number;
  /** How long a single call may take before it counts as a miss. */
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class ServiceInspector implements Inspector {
  readonly kind = "service";
  readonly #options: Required<Omit<ServiceInspectorOptions, "fetchImpl">> & {
    fetchImpl: typeof fetch;
  };
  readonly #latest = new Map<string, ServiceResponse>();
  readonly #inFlight = new Set<string>();
  #misses = 0;
  #failures = 0;
  #calls = 0;

  constructor(options: ServiceInspectorOptions) {
    this.#options = {
      endpoint: options.endpoint.replace(/\/$/, ""),
      threshold: options.threshold,
      timeoutMs: options.timeoutMs ?? 750,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  /** Inspections the service had not answered in time. */
  get misses(): number {
    return this.#misses;
  }

  /** Calls that errored or returned an unusable body. */
  get failures(): number {
    return this.#failures;
  }

  get calls(): number {
    return this.#calls;
  }

  static key(productId: string, stationId: string): string {
    return `${productId}@${stationId}`;
  }

  inspect(request: InspectionRequest, station: StationConfig): InspectionOutcome {
    const key = ServiceInspector.key(request.productId, request.stationId);
    const response = this.#latest.get(key);

    // Ask for next time regardless; the line does not wait for the answer.
    this.#request(request, station, key);

    if (!response) {
      this.#misses += 1;
      return { detectedDefectIds: [], falsePositive: false, defectProbability: 0 };
    }
    this.#latest.delete(key);
    return this.#toOutcome(response, request);
  }

  /**
   * Map the model's class names back onto the defects actually on the unit.
   *
   * A detection the twin cannot tie to a known defect is *not* discarded — it
   * becomes a false positive, which is exactly what an unexplained rejection is
   * on the floor.
   */
  #toOutcome(response: ServiceResponse, request: InspectionRequest): InspectionOutcome {
    const confident = response.detections.filter(
      (detection) =>
        detection.score >= this.#options.threshold && detection.label.toUpperCase() !== "OK",
    );

    const detected: string[] = [];
    const claimed = new Set<string>();
    for (const detection of confident) {
      const match = request.presentDefects.find(
        (defect) => defect.type === detection.label.toUpperCase() && !claimed.has(defect.id),
      );
      if (!match) continue;
      claimed.add(match.id);
      detected.push(match.id);
    }

    const unexplained = confident.length - detected.length;
    const best = confident.reduce((high, detection) => Math.max(high, detection.score), 0);

    return {
      detectedDefectIds: detected,
      // The gate rejected a unit the twin knows to be clean: a false positive.
      falsePositive: detected.length === 0 && unexplained > 0,
      defectProbability:
        confident.length > 0
          ? Number(best.toFixed(3))
          : scoreConfidence(0, false, request.presentDefects.length),
    };
  }

  /** Fire-and-forget request; the result lands in the cache for the next tick. */
  #request(request: InspectionRequest, station: StationConfig, key: string): void {
    if (this.#inFlight.has(key)) return;
    this.#inFlight.add(key);
    this.#calls += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#options.timeoutMs);

    void this.#options
      .fetchImpl(`${this.#options.endpoint}/v1/inspect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          productId: request.productId,
          stationId: request.stationId,
          camera: request.cameraId ?? station.id,
          method: station.inspection.method,
          simulatedTime: request.simulatedTime,
        }),
      })
      .then(async (response) => {
        if (!response.ok) throw new Error(`inference service ${response.status}`);
        const body = (await response.json()) as ServiceResponse;
        if (!Array.isArray(body.detections)) throw new Error("malformed inference response");
        this.#latest.set(key, body);
      })
      .catch(() => {
        // A failure is counted and stays a miss. It never becomes a pass.
        this.#failures += 1;
      })
      .finally(() => {
        clearTimeout(timer);
        this.#inFlight.delete(key);
      });
  }
}
