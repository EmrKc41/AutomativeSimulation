import {
  LegacyOptimizer,
  type Assignment,
  type DispatchView,
  type Optimizer,
} from "./optimizer.ts";
import { travelTicks } from "./factory.ts";

/**
 * A dispatch policy backed by a solver service — cuOpt, or anything that speaks
 * the same shape.
 *
 * cuOpt's routing API solves exactly the problem the move jobs pose: a fleet, a
 * set of pickup-and-delivery tasks, a cost matrix, and constraints. On a plant
 * this size a greedy rule is already close to optimal, so this is not here
 * because three vehicles need a GPU. It is here because the *seam* has to be
 * proven against a real solver before anyone scales the layout to forty
 * vehicles and two hundred jobs, where the greedy rule genuinely falls apart.
 *
 * **Read `SlackAwareOptimizer` first.** On this factory as configured, the
 * measured result is that vehicle dispatch has nothing to win: jobs are picked
 * up the minute they are raised, so no station ever waits on a vehicle. A
 * solver cannot beat a wait of zero. Wiring this in and reporting an
 * improvement would be reporting noise.
 *
 * Three properties, the same ones the inference adapter holds to:
 *
 * **It never blocks the tick.** The solve is asked for asynchronously and the
 * newest answer is used when it arrives. A tick that waited on a solver would
 * be measuring network latency as production time.
 *
 * **It always answers.** No plan yet, a timeout, a malformed body — the local
 * dispatch rule answers instead. A plant does not stop moving material because
 * an optimiser is down.
 *
 * **It never trusts the plan.** The engine re-checks every pair; this class
 * additionally drops anything that does not name a vehicle and a job that were
 * actually offered. A solver is a remote service, and its output is data.
 */

/** What the solver is asked. Deliberately cuOpt-shaped. */
export interface SolveRequest {
  readonly time: number;
  readonly vehicles: readonly { readonly id: string; readonly location: string }[];
  readonly jobs: readonly {
    readonly id: string;
    readonly pickup: string;
    readonly dropoff: string;
    readonly readyAt: number;
  }[];
  /**
   * Travel minutes between every location that appears above.
   *
   * Sent explicitly rather than left for the solver to derive: the plant's
   * travel time is the engine's own function, and a solver optimising a
   * different distance would produce a plan that is optimal for a factory that
   * does not exist. That exact mistake was made once already in this phase.
   */
  readonly costMatrix: {
    readonly locations: readonly string[];
    readonly minutes: readonly (readonly number[])[];
  };
}

export interface SolveResponse {
  readonly assignments: readonly { readonly vehicleId: string; readonly jobId: string }[];
  readonly solver?: string;
  readonly objective?: number;
}

export interface SolverOptions {
  /** Base URL of the solver service, e.g. http://localhost:5000 */
  readonly endpoint: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Answers while the solver has not replied. Defaults to the shipped rule. */
  readonly fallback?: Optimizer;
}

export class SolverOptimizer implements Optimizer {
  readonly kind = "solver";
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #fallback: Optimizer;
  #plan: SolveResponse | null = null;
  #planKey: string | null = null;
  #inFlight = false;
  #solves = 0;
  #used = 0;
  #failures = 0;

  constructor(options: SolverOptions) {
    this.#endpoint = options.endpoint.replace(/\/$/, "");
    this.#timeoutMs = options.timeoutMs ?? 500;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#fallback = options.fallback ?? new LegacyOptimizer();
  }

  /** Solves requested. */
  get solves(): number {
    return this.#solves;
  }

  /** Ticks that used a solver plan rather than the local rule. */
  get used(): number {
    return this.#used;
  }

  /** Solves that errored, timed out, or came back unusable. */
  get failures(): number {
    return this.#failures;
  }

  /** Release sequencing is not a routing problem; the local policy owns it. */
  nextRelease = (view: Parameters<Optimizer["nextRelease"]>[0]) => this.#fallback.nextRelease(view);

  dispatch(view: DispatchView): readonly Assignment[] {
    const key = situationKey(view);
    this.#request(view, key);

    // Only a plan solved for *this* situation may be used. A plan for a fleet
    // that has since moved is not a stale optimum, it is a wrong answer.
    if (this.#plan === null || this.#planKey !== key) return this.#fallback.dispatch(view);

    const offeredVehicles = new Set(view.vehicles.map((vehicle) => vehicle.id));
    const offeredJobs = new Set(view.jobs.map((job) => job.id));
    const pairs: Assignment[] = [];
    for (const pair of this.#plan.assignments) {
      if (!offeredVehicles.has(pair.vehicleId) || !offeredJobs.has(pair.jobId)) continue;
      pairs.push({ agvId: pair.vehicleId, taskId: pair.jobId });
    }

    // A plan that explains nothing is not a plan. Falling through to the local
    // rule keeps material moving instead of leaving vehicles parked.
    if (pairs.length === 0) return this.#fallback.dispatch(view);
    this.#used += 1;
    return pairs;
  }

  /** Fire-and-forget solve; the answer lands for a later tick. */
  #request(view: DispatchView, key: string): void {
    if (this.#inFlight) return;
    this.#inFlight = true;
    this.#solves += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    void this.#fetch(`${this.#endpoint}/v1/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(buildRequest(view)),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`solver ${response.status}`);
        const body = (await response.json()) as SolveResponse;
        if (!Array.isArray(body.assignments)) throw new Error("malformed solver response");
        this.#plan = body;
        this.#planKey = key;
      })
      .catch(() => {
        this.#failures += 1;
        this.#plan = null;
        this.#planKey = null;
      })
      .finally(() => {
        clearTimeout(timer);
        this.#inFlight = false;
      });
  }
}

/**
 * Identity of the situation being solved: which vehicles are free, where they
 * stand, and which jobs are open.
 */
export function situationKey(view: DispatchView): string {
  const vehicles = view.vehicles
    .map((vehicle) => `${vehicle.id}@${vehicle.location}`)
    .sort()
    .join(",");
  const jobs = view.jobs
    .map((job) => job.id)
    .sort()
    .join(",");
  return `${vehicles}|${jobs}`;
}

export function buildRequest(view: DispatchView): SolveRequest {
  const locations = [
    ...new Set([
      ...view.vehicles.map((vehicle) => vehicle.location),
      ...view.jobs.flatMap((job) => [job.from, job.to]),
    ]),
  ].sort();

  return {
    time: view.time,
    vehicles: view.vehicles.map((vehicle) => ({ id: vehicle.id, location: vehicle.location })),
    jobs: view.jobs.map((job) => ({
      id: job.id,
      pickup: job.from,
      dropoff: job.to,
      readyAt: job.createdAt,
    })),
    costMatrix: {
      locations,
      minutes: locations.map((from) =>
        locations.map((to) => (from === to ? 0 : travelTicks(view.config, from, to))),
      ),
    },
  };
}
