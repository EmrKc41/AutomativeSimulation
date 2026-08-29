import type {
  AndonState,
  AndonStop,
  Command,
  CommandResult,
  FactoryFrame,
  InventorySummary,
  ProductUnit,
  RuntimeStatus,
  ScenarioKind,
  SimulationResult,
} from "./domain.ts";
import { run, snapshot, tick } from "./engine.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation, type SimulationState } from "./state.ts";

/**
 * The live simulation host.
 *
 * The engine is a pure function of its state; this class is the only thing that
 * owns wall-clock time. It advances the factory, publishes one frame per tick,
 * and accepts commands. Nothing here decides factory behaviour — that stays in
 * the engine, so a batch run and a live run produce the same history.
 */

export interface RuntimeOptions {
  readonly seed?: number;
  readonly scenario?: ScenarioKind;
  /** Wall-clock milliseconds per simulated tick at speed 1. */
  readonly tickIntervalMs?: number;
  /** Ticks to advance before publishing the first frame. */
  readonly warmupTicks?: number;
}

export type FrameListener = (frame: FactoryFrame) => void;

const DEFAULT_TICK_INTERVAL_MS = 250;
/** Below this the browser cannot usefully repaint, so we batch ticks instead. */
const MIN_TIMER_INTERVAL_MS = 50;
const ALLOWED_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16] as const;
/** How many finished units a frame carries alongside live WIP. */
const FINISHED_TAIL = 12;
/**
 * How many past events a first frame carries.
 *
 * Enough to fill the timeline a client actually renders, and no more. The
 * browser keeps 600 and displays 160; sending 2,572 to deliver 600 was waste
 * that grew with uptime rather than staying still. Full history is at
 * `GET /api/events`, which pages and filters.
 */
const EVENT_TAIL = 600;

export class SimulationRuntime {
  #state: SimulationState;
  #simulationId: string;
  #sequence = 0;
  #status: RuntimeStatus = "paused";
  #speed = 1;
  #timer: ReturnType<typeof setInterval> | null = null;
  #publishedEvents = 0;
  #commandCount = 0;
  #runCount = 0;
  #tickFailures = 0;
  #droppedListeners = 0;
  readonly #listeners = new Set<FrameListener>();
  readonly #tickIntervalMs: number;
  #seed: number;
  #scenario: ScenarioKind;

  constructor(options: RuntimeOptions = {}) {
    this.#seed = options.seed ?? 42;
    this.#scenario = options.scenario ?? "normal";
    this.#tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.#simulationId = this.#nextSimulationId();
    this.#state = createSimulation({
      seed: this.#seed,
      scenario: scenarios[this.#scenario],
    });
    if (options.warmupTicks) run(this.#state, options.warmupTicks);
    // Whatever already happened belongs to history, not to the next delta. A
    // client connecting before the first publish used to get the opening-stock
    // events twice: once in its hello, once in the first delta from index 0.
    this.#publishedEvents = this.#state.events.length;
  }

  // -- observation --------------------------------------------------------

  get status(): RuntimeStatus {
    return this.#status;
  }

  get speed(): number {
    return this.#speed;
  }

  get simulationId(): string {
    return this.#simulationId;
  }

  get state(): SimulationState {
    return this.#state;
  }

  /** Ticks that threw. Non-zero means the run is no longer trustworthy. */
  get tickFailures(): number {
    return this.#tickFailures;
  }

  /** Subscribers dropped for throwing. Usually sockets that died mid-write. */
  get droppedListeners(): number {
    return this.#droppedListeners;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  /** Complete history, for REST callers that need more than the live frame. */
  getSnapshot(): SimulationResult {
    return snapshot(this.#state);
  }

  /**
   * The current frame.
   *
   * `includeHistory` carries a bounded tail of past events, which is what a
   * client needs on its first connection; live frames carry only the delta.
   * `eventsTotal` tells the caller whether anything was left behind.
   */
  getFrame(includeHistory = false): FactoryFrame {
    const events = includeHistory
      ? this.#state.events.slice(-EVENT_TAIL)
      : this.#state.events.slice(this.#publishedEvents);

    return {
      v: 1,
      simulationId: this.#simulationId,
      sequence: this.#sequence,
      simulatedTime: this.#state.time,
      status: this.#status,
      speed: this.#speed,
      scenario: this.#scenario,
      seed: this.#seed,
      metrics: this.#state.metrics,
      machines: this.#state.machines,
      agvs: this.#state.agvs,
      shipments: this.#state.shipments,
      workOrders: this.#state.workOrders,
      activeProducts: this.#activeProducts(),
      openAlerts: this.#state.alerts.filter((alert) => alert.resolvedAt === null),
      andon: this.#andon(),
      inventory: this.#inventorySummary(),
      events,
      eventsTotal: this.#state.events.length,
    };
  }

  subscribe(listener: FrameListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  // -- commands -----------------------------------------------------------

  execute(command: Command): CommandResult {
    this.#commandCount += 1;
    const commandId = `cmd-${String(this.#commandCount).padStart(5, "0")}`;
    const accept = (message: string): CommandResult => ({
      commandId,
      accepted: true,
      message,
      simulatedTime: this.#state.time,
      sequence: this.#sequence,
    });
    const reject = (message: string): CommandResult => ({
      commandId,
      accepted: false,
      message,
      simulatedTime: this.#state.time,
      sequence: this.#sequence,
    });

    switch (command.type) {
      case "PLAY":
        if (this.#status === "running") return accept("already running");
        this.#status = "running";
        this.#startTimer();
        this.#publish();
        return accept("running");

      case "PAUSE":
        if (this.#status === "paused") return accept("already paused");
        this.#stopTimer();
        this.#status = "paused";
        this.#publish();
        return accept("paused");

      case "STEP": {
        const ticks = command.ticks ?? 1;
        if (!Number.isInteger(ticks) || ticks < 1 || ticks > 1000) {
          return reject("step ticks must be an integer between 1 and 1000");
        }
        this.#stopTimer();
        this.#status = "paused";
        run(this.#state, ticks);
        this.#publish();
        return accept(`advanced ${ticks} tick(s)`);
      }

      case "SET_SPEED": {
        if (!ALLOWED_SPEEDS.includes(command.speed as (typeof ALLOWED_SPEEDS)[number])) {
          return reject(`speed must be one of ${ALLOWED_SPEEDS.join(", ")}`);
        }
        this.#speed = command.speed;
        if (this.#status === "running") this.#startTimer();
        this.#publish();
        return accept(`speed ${command.speed}x`);
      }

      case "RESET":
      case "LOAD_SCENARIO": {
        const scenario = command.scenario ?? this.#scenario;
        if (!Object.hasOwn(scenarios, scenario)) return reject(`unknown scenario "${scenario}"`);
        const seed = command.seed ?? this.#seed;
        if (!Number.isFinite(seed)) return reject("seed must be a number");
        this.#reset(scenario, seed);
        return accept(`loaded ${scenario} at seed ${seed}`);
      }

      case "ACKNOWLEDGE_ALERT": {
        const alert = this.#state.alerts.find((candidate) => candidate.id === command.alertId);
        if (!alert) return reject(`unknown alert "${command.alertId}"`);
        alert.acknowledged = true;
        this.#publish();
        return accept(`acknowledged ${alert.id}`);
      }

      default:
        return reject("unknown command");
    }
  }

  /** Stop the timer and drop subscribers; call before discarding the runtime. */
  dispose(): void {
    this.#stopTimer();
    this.#listeners.clear();
  }

  // -- internals ----------------------------------------------------------

  #reset(scenario: ScenarioKind, seed: number): void {
    this.#stopTimer();
    this.#status = "paused";
    this.#scenario = scenario;
    this.#seed = seed;
    this.#sequence = 0;
    this.#simulationId = this.#nextSimulationId();
    this.#state = createSimulation({ seed, scenario: scenarios[scenario] });
    // Same rule after a reset: the fresh run's opening events are history the
    // moment they exist, and #publish() below re-syncs every client anyway.
    this.#publishedEvents = this.#state.events.length;
    this.#publish();
  }

  #nextSimulationId(): string {
    this.#runCount += 1;
    return `sim-${String(this.#runCount).padStart(4, "0")}`;
  }

  /**
   * Below `MIN_TIMER_INTERVAL_MS` we keep the timer steady and advance several
   * ticks per fire. Shrinking the interval instead would starve the event loop
   * and make high speeds jerkier, not faster.
   */
  #startTimer(): void {
    this.#stopTimer();
    const desired = this.#tickIntervalMs / this.#speed;
    const interval = Math.max(MIN_TIMER_INTERVAL_MS, desired);
    const ticksPerFire = Math.max(1, Math.round(interval / desired));

    this.#timer = setInterval(() => {
      // Nothing thrown in here may escape. An exception inside a `setInterval`
      // callback is an uncaught exception, and an uncaught exception ends the
      // process — so before this guard existed, one client socket dying
      // mid-write took the whole plant down for everyone still watching. That
      // was reproduced, not theorised.
      try {
        for (let index = 0; index < ticksPerFire; index += 1) tick(this.#state);
      } catch (error) {
        // A failing tick is different from a failing subscriber: the run's own
        // state may now be inconsistent, so the line is stopped and the
        // operator is told, rather than the simulation carrying on and
        // producing numbers nobody should trust.
        this.#tickFailures += 1;
        this.#status = "paused";
        this.#stopTimer();
        console.error(
          `[motor] ${this.#state.time}. dakikada tick hatası; koşu durduruldu:`,
          error instanceof Error ? error.message : error,
        );
      }
      this.#publish();
    }, interval);
    this.#timer.unref?.();
  }

  #stopTimer(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Hand the frame to every subscriber, and survive the ones that fail.
   *
   * A subscriber that throws is dropped rather than retried. In practice it is
   * a socket that closed between the readiness check and the write, and there
   * is nothing to be gained by offering it the next frame — but every *other*
   * viewer must still get theirs, which is the part that used to break.
   */
  #publish(): void {
    this.#sequence += 1;
    const frame = this.getFrame();
    this.#publishedEvents = this.#state.events.length;

    let broken: FrameListener[] | null = null;
    for (const listener of this.#listeners) {
      try {
        listener(frame);
      } catch (error) {
        // Collected rather than deleted mid-iteration: mutating the set while
        // walking it is how the *fix* introduces its own bug.
        (broken ??= []).push(listener);
        this.#droppedListeners += 1;
        console.error(
          "[motor] abone hata verdi, bağlantı düşürüldü:",
          error instanceof Error ? error.message : error,
        );
      }
    }
    if (broken) for (const listener of broken) this.#listeners.delete(listener);
  }

  /** Units on the line, plus a short tail of finished ones for context. */
  #activeProducts(): ProductUnit[] {
    const live: ProductUnit[] = [];
    const finished: ProductUnit[] = [];
    for (const product of this.#state.products) {
      if (
        product.status === "QUEUED" ||
        product.status === "IN_PRODUCTION" ||
        product.status === "IN_REWORK" ||
        product.status === "READY_TO_SHIP" ||
        product.status === "LOADING"
      ) {
        live.push(product);
      } else {
        finished.push(product);
      }
    }
    return [...live, ...finished.slice(-FINISHED_TAIL)];
  }

  /**
   * Stations that are down right now.
   *
   * Only unplanned stops count. Planned maintenance is scheduled work, not an
   * andon, and treating the two the same would teach an operator to ignore the
   * signal that matters.
   */
  #andon(): AndonState {
    const stops: AndonStop[] = this.#state.machines
      .filter((machine) => machine.status === "DOWN")
      .map((machine) => {
        const failure = [...this.#state.events]
          .filter((event) => event.type === "MACHINE_FAILURE" && event.source === machine.id)
          .at(-1);
        const since = failure?.occurredAt ?? this.#state.time;
        return {
          machineId: machine.id,
          station: machine.station,
          since,
          elapsedMinutes: this.#state.time - since,
          estimatedRemaining: machine.repairTicksRemaining,
          heldProductId: machine.currentProductId,
        };
      })
      .sort((left, right) => left.since - right.since);

    return {
      active: stops.length > 0,
      stops,
      raisedAt: stops[0]?.since ?? null,
    };
  }

  #inventorySummary(): InventorySummary[] {
    const totals = new Map<string, InventorySummary>();
    for (const balance of this.#state.inventory) {
      if (balance.quantity <= 0) continue;
      const key = `${balance.materialId}@${balance.location}@${balance.status}`;
      const existing = totals.get(key);
      if (existing) {
        totals.set(key, { ...existing, quantity: existing.quantity + balance.quantity });
        continue;
      }
      totals.set(key, {
        materialId: balance.materialId,
        location: balance.location,
        quantity: balance.quantity,
        status: balance.status,
      });
    }
    return [...totals.values()].sort(
      (left, right) =>
        left.materialId.localeCompare(right.materialId) ||
        left.location.localeCompare(right.location),
    );
  }
}
