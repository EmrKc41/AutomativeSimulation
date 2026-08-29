import type { FactoryEvent } from "./domain.ts";

/** Append-only event history with idempotent writes at the consumer boundary. */
export class EventStore extends Array<FactoryEvent> {
  readonly #eventIds = new Set<string>();

  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  append(event: FactoryEvent): boolean {
    if (this.#eventIds.has(event.eventId)) return false;
    this.#eventIds.add(event.eventId);
    super.push(event);
    return true;
  }
}
