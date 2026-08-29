/**
 * Deterministic 32-bit PRNG (mulberry32).
 *
 * Every stochastic decision in the factory — machine breakdowns, defect
 * occurrence, inspection recall, cycle-time variation, incoming-QC rejection —
 * draws from this generator. A seed therefore reproduces a whole factory day
 * bit-for-bit, which is what makes baseline-vs-disruption comparison honest.
 */
export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Bernoulli trial. */
  chance(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  /** Uniform choice; throws on an empty list so a mis-seeded table fails loudly. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.nextInt(0, items.length - 1)];
    if (item === undefined) throw new Error("Rng.pick requires a non-empty list");
    return item;
  }

  /** Independent stream derived from this one, for per-subsystem isolation. */
  fork(salt: number): Rng {
    return new Rng((this.#state ^ Math.imul(salt, 0x9e3779b1)) >>> 0);
  }

  /** Serialisable internal state, so a run can be snapshotted and resumed. */
  get state(): number {
    return this.#state;
  }
}
