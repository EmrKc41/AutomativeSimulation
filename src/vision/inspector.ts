import type { Defect, InspectionMethod, StationConfig } from "../domain.ts";
import type { Rng } from "../rng.ts";

/**
 * The seam between the factory and whatever is looking at it.
 *
 * The engine does not know how a defect is found. It hands an inspector the
 * unit, the station and the defects physically present, and gets back what was
 * detected. That is the whole contract, and it is the same contract a
 * DeepStream pipeline would satisfy: frames in, detections out.
 *
 * Everything downstream — the `Inspection` record, the rework decision, the
 * traceability trail, the KPI — is computed by the engine from the outcome, so
 * swapping a simulated inspector for a real one changes no rule and no number's
 * meaning. Only its source.
 */

export interface InspectionRequest {
  readonly productId: string;
  readonly stationId: string;
  readonly cameraId: string | null;
  readonly method: InspectionMethod;
  readonly simulatedTime: number;
  /** Defects actually on the unit that no earlier gate has caught or resolved. */
  readonly presentDefects: readonly Defect[];
}

export interface InspectionOutcome {
  readonly detectedDefectIds: readonly string[];
  /** A clean unit rejected anyway. */
  readonly falsePositive: boolean;
  /** The inspector's own confidence that the unit is defective, 0..1. */
  readonly defectProbability: number;
}

export interface Inspector {
  /** Recorded on the run so a report can say what looked at the unit. */
  readonly kind: string;
  inspect(request: InspectionRequest, station: StationConfig): InspectionOutcome;
}

/**
 * The default: a detector with a configured recall and false-positive rate.
 *
 * It is honest about being a model of a camera rather than a camera. Recall
 * below 1 is the important part — a gate that catches everything would hide the
 * escape path the final gate exists to cover.
 */
export class SimulatedInspector implements Inspector {
  readonly kind = "simulated";
  readonly #rng: Rng;

  constructor(rng: Rng) {
    this.#rng = rng;
  }

  inspect(request: InspectionRequest, station: StationConfig): InspectionOutcome {
    const detected: string[] = [];
    for (const defect of request.presentDefects) {
      if (this.#rng.chance(station.inspection.recall)) detected.push(defect.id);
    }

    const falsePositive =
      request.presentDefects.length === 0 && this.#rng.chance(station.inspection.falsePositiveRate);

    return {
      detectedDefectIds: detected,
      falsePositive,
      defectProbability: scoreConfidence(
        detected.length,
        falsePositive,
        request.presentDefects.length,
      ),
    };
  }
}

/**
 * Replays detections recorded elsewhere — a captured DeepStream run, a
 * labelled test set, or a golden case an engineer wants to re-run.
 *
 * Anything the recording does not cover is reported as a clean pass rather than
 * guessed at, because an inspector that invents a detection when its source is
 * silent is worse than one that admits it saw nothing.
 */
export class RecordedInspector implements Inspector {
  readonly kind = "recorded";
  readonly #outcomes: Map<string, InspectionOutcome>;
  #misses = 0;

  constructor(records: Iterable<readonly [string, InspectionOutcome]>) {
    this.#outcomes = new Map(records);
  }

  static key(productId: string, stationId: string): string {
    return `${productId}@${stationId}`;
  }

  /** How many inspections the recording had nothing to say about. */
  get misses(): number {
    return this.#misses;
  }

  inspect(request: InspectionRequest): InspectionOutcome {
    const outcome = this.#outcomes.get(RecordedInspector.key(request.productId, request.stationId));
    if (outcome) return outcome;
    this.#misses += 1;
    return { detectedDefectIds: [], falsePositive: false, defectProbability: 0 };
  }
}

/**
 * An inspector that misses nothing. Useful for isolating a quality problem from
 * a detection problem: run the same seed with this and any remaining rework is
 * caused by the process, not by the camera.
 */
export class PerfectInspector implements Inspector {
  readonly kind = "perfect";

  inspect(request: InspectionRequest): InspectionOutcome {
    const detected = request.presentDefects.map((defect) => defect.id);
    return {
      detectedDefectIds: detected,
      falsePositive: false,
      defectProbability: scoreConfidence(detected.length, false, request.presentDefects.length),
    };
  }
}

/**
 * Turn a detection count into a reported confidence.
 *
 * Shared so every inspector reports on the same scale — a probability that
 * means one thing on the paint gate and another on the final gate would make
 * the number useless in a report.
 */
export function scoreConfidence(
  detectedCount: number,
  falsePositive: boolean,
  presentCount: number,
): number {
  if (detectedCount > 0) return Number(Math.min(0.99, 0.9 + detectedCount * 0.03).toFixed(3));
  if (falsePositive) return 0.55;
  return Number(Math.min(0.08, presentCount * 0.03 + 0.01).toFixed(3));
}
