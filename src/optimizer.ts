import type { FactoryConfig } from "./domain.ts";
import { travelTicks } from "./factory.ts";

/**
 * The planning decisions, behind one seam.
 *
 * The engine makes two choices every tick that are not physics: **which work
 * order goes onto the line next**, and **which vehicle takes which move job**.
 * Everything else — how long a press takes, whether a weld fails — is the
 * factory being itself. These two are a plan, and a plan can be wrong in ways
 * that are worth measuring.
 *
 * Separating them out does three things:
 *
 * 1. The rule becomes visible. Today's release policy is "highest priority,
 *    then earliest due date" and today's dispatch is "first free vehicle takes
 *    the oldest job". Both are defensible; neither was ever *chosen*, because
 *    they were buried in the middle of the tick.
 * 2. It becomes swappable, so a solver can be put behind it without touching a
 *    single factory rule.
 * 3. It becomes **comparable**. Two policies, one seed, one factory: the
 *    difference is the policy's contribution and nothing else.
 *
 * Point 3 is the reason this exists. An optimiser that is never measured
 * against the dispatch rule it replaced is a claim, not a result.
 *
 * The optimiser sees a **view**, not the live state. It cannot move a vehicle,
 * fail a weld or release a unit; it returns a decision and the engine applies
 * it. That keeps a remote solver from being able to corrupt a run, and keeps
 * every policy testable as a pure function.
 */

// ---------------------------------------------------------------------------
// What the optimiser is allowed to see
// ---------------------------------------------------------------------------

/** One work order, as the release decision sees it. */
export interface ReleaseCandidate {
  readonly id: string;
  readonly priority: number;
  readonly dueTick: number;
  readonly quantity: number;
  readonly released: number;
  readonly completed: number;
  readonly scrapped: number;
}

export interface ReleaseView {
  readonly time: number;
  /** Only orders with units left to release; an empty list means nothing to do. */
  readonly candidates: readonly ReleaseCandidate[];
  /** Minutes of demand per unit — the line's heartbeat. */
  readonly taktTime: number;
  /** Units already on the line, against the CONWIP cap. */
  readonly wip: number;
  readonly wipCap: number;
}

/** One vehicle, as the dispatch decision sees it. */
export interface DispatchVehicle {
  readonly id: string;
  /** Where it is standing. Only idle vehicles are offered. */
  readonly location: string;
}

/** One outstanding move job. */
export interface DispatchJob {
  readonly id: string;
  readonly materialId: string;
  readonly from: string;
  readonly to: string;
  /** When the pull signal was raised, for ageing. */
  readonly createdAt: number;
}

export interface DispatchView {
  readonly time: number;
  readonly vehicles: readonly DispatchVehicle[];
  readonly jobs: readonly DispatchJob[];
  readonly config: FactoryConfig;
}

/** One vehicle takes one job. */
export interface Assignment {
  readonly agvId: string;
  readonly taskId: string;
}

export interface Optimizer {
  readonly kind: string;
  /**
   * Which order to release next, or null to release nothing this tick.
   *
   * Returning null is a real answer, not a failure: holding the line back is
   * sometimes the right call, and a policy that can only say "go" cannot make
   * it.
   */
  nextRelease(view: ReleaseView): string | null;
  /**
   * Which vehicles take which jobs.
   *
   * May return fewer pairs than there are idle vehicles. It must never return
   * the same vehicle or the same job twice; the engine rejects duplicates
   * rather than trusting the answer.
   */
  dispatch(view: DispatchView): readonly Assignment[];
}

// ---------------------------------------------------------------------------
// The policy that was already there
// ---------------------------------------------------------------------------

/**
 * The rules the engine used before this seam existed, kept verbatim.
 *
 * This is not dead code. It is the **baseline**: the number every other policy
 * has to beat before it can be called an improvement. Deleting it would make
 * the comparison impossible, which is how optimisers come to be believed
 * without evidence.
 */
export class LegacyOptimizer implements Optimizer {
  readonly kind = "legacy";

  nextRelease(view: ReleaseView): string | null {
    if (view.candidates.length === 0) return null;
    const open = [...view.candidates];
    open.sort((left, right) => left.priority - right.priority || left.dueTick - right.dueTick);
    return open[0]?.id ?? null;
  }

  dispatch(view: DispatchView): readonly Assignment[] {
    // First free vehicle takes the first pending job, wherever either of them
    // happens to be. Distance never entered into it.
    const pairs: Assignment[] = [];
    const jobs = [...view.jobs];
    for (const vehicle of view.vehicles) {
      const job = jobs.shift();
      if (!job) break;
      pairs.push({ agvId: vehicle.id, taskId: job.id });
    }
    return pairs;
  }
}

// ---------------------------------------------------------------------------
// The policy that ships
// ---------------------------------------------------------------------------

/**
 * The critical ratio below which an order is treated as at risk.
 *
 * Below 1.0 the order cannot finish by its due date even if the line runs at
 * takt from now on. That is not a preference, it is arithmetic, and it is the
 * only thing allowed to interrupt a batch.
 */
const AT_RISK_RATIO = 1;

/**
 * Release by slack, but only when something is actually at risk.
 *
 * This is the third version. The first two were measured and thrown away, and
 * the reasons are worth keeping because they are the whole result of this phase.
 *
 * **Attempt 1 — pure critical ratio.** Sort every order by how close it is to
 * missing its date, always release the most urgent. It cut lateness in the
 * demand-surge scenario by 557 minutes, and *added* lateness in all five other
 * scenarios. The mechanism is plain once seen: as an order gets released its
 * remaining work shrinks, its ratio improves, and the policy switches away to a
 * different order — so three orders that used to finish one after another now
 * finish together, at the end, all slightly late. Urgency with no memory
 * interleaves everything.
 *
 * **Attempt 2 — nearest vehicle for the move jobs.** Two thirds of vehicle
 * travel is empty running, so choosing the closest vehicle looks obviously
 * right. Measured, it made travel *worse* by 330 minutes. Also plain once seen:
 * pickups are nearly all at the raw store, so "nearest to the store" keeps
 * picking the same vehicle while the others drift to the far end of the line
 * and stay there. The baseline's round-robin spreads the fleet out by accident,
 * which on this layout is better than choosing on purpose.
 *
 * **What ships.** Finish the batch you started — that is what the old rule did,
 * and it was right — unless an order's arithmetic says it can no longer make
 * its date, in which case that order pre-empts. Slack is used as an alarm, not
 * as a sort key.
 *
 * Vehicle dispatch is left exactly as it was, because the measurement said so.
 */
export class SlackAwareOptimizer implements Optimizer {
  readonly kind = "slack-aware";
  readonly #baseline = new LegacyOptimizer();

  nextRelease(view: ReleaseView): string | null {
    if (view.candidates.length === 0) return null;

    const scored = view.candidates.map((order) => ({ order, ratio: criticalRatio(order, view) }));
    const atRisk = scored.filter((entry) => entry.ratio < AT_RISK_RATIO);

    // Nothing is in danger: keep the sequence stable and finish what is open.
    if (atRisk.length === 0) return this.#baseline.nextRelease(view);

    // Something is. The most endangered order goes first; priority still breaks
    // ties, because it carries a commercial fact the clock cannot see.
    atRisk.sort(
      (left, right) =>
        left.ratio - right.ratio ||
        left.order.priority - right.order.priority ||
        left.order.dueTick - right.order.dueTick,
    );
    return atRisk[0]?.order.id ?? null;
  }

  dispatch(view: DispatchView): readonly Assignment[] {
    return this.#baseline.dispatch(view);
  }
}

/**
 * Time left divided by work left, both in minutes.
 *
 * Below 1 the order cannot make its date at takt. A date already past returns a
 * negative number, so an order that is late outranks every order that is merely
 * about to be.
 */
function criticalRatio(order: ReleaseCandidate, view: ReleaseView): number {
  const remaining = order.quantity - order.completed - order.scrapped;
  if (remaining <= 0) return Number.POSITIVE_INFINITY;
  const workLeft = remaining * view.taktTime;
  const timeLeft = order.dueTick - view.time;
  return timeLeft <= 0 ? -1 / Math.max(1, workLeft) : timeLeft / workLeft;
}

// ---------------------------------------------------------------------------
// Measured and rejected — kept so the comparison can be re-run
// ---------------------------------------------------------------------------

/**
 * How long a job may wait before its age outweighs a shorter drive.
 *
 * Pure nearest-vehicle dispatch starves the far end of the plant: a job at the
 * shipping yard loses every auction to a job by the presses. Ageing is what
 * stops a locally optimal rule from being globally unfair.
 */
const AGEING_MINUTES = 8;

/**
 * Urgency-first release and nearest-vehicle dispatch.
 *
 * **This policy is worse than the baseline on this plant** — see
 * `SlackAwareOptimizer` for the numbers and the reasons. It is kept, and kept
 * runnable from `npm run optimize`, because a rejected policy that cannot be
 * re-run is just an anecdote. Change the layout, the fleet size or the order
 * book and the answer may well flip; the harness is here so that gets checked
 * rather than assumed.
 */
export class NearestVehicleOptimizer implements Optimizer {
  readonly kind = "nearest-vehicle";

  nextRelease(view: ReleaseView): string | null {
    if (view.candidates.length === 0) return null;
    const scored = view.candidates.map((order) => ({ order, ratio: criticalRatio(order, view) }));
    scored.sort(
      (left, right) =>
        left.ratio - right.ratio ||
        left.order.priority - right.order.priority ||
        left.order.dueTick - right.order.dueTick,
    );
    return scored[0]?.order.id ?? null;
  }

  dispatch(view: DispatchView): readonly Assignment[] {
    const pairs: Assignment[] = [];
    const free = [...view.vehicles];
    const open = [...view.jobs];

    // Greedy on the cheapest remaining pair. Ties break by id so the same run
    // always produces the same plan.
    while (free.length > 0 && open.length > 0) {
      let bestVehicle = 0;
      let bestJob = 0;
      let bestCost = Number.POSITIVE_INFINITY;

      for (let v = 0; v < free.length; v += 1) {
        for (let j = 0; j < open.length; j += 1) {
          const vehicle = free[v]!;
          const job = open[j]!;
          const cost =
            travelTicks(view.config, vehicle.location, job.from) -
            (view.time - job.createdAt) / AGEING_MINUTES;
          if (cost < bestCost - 1e-9) {
            bestCost = cost;
            bestVehicle = v;
            bestJob = j;
          }
        }
      }

      pairs.push({ agvId: free[bestVehicle]!.id, taskId: open[bestJob]!.id });
      free.splice(bestVehicle, 1);
      open.splice(bestJob, 1);
    }

    return pairs;
  }
}
