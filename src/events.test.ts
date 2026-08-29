import assert from "node:assert/strict";
import test from "node:test";

import { EventStore } from "./events.ts";

test("event store preserves insertion order and rejects duplicate event IDs", () => {
  const store = new EventStore();
  const event = {
    eventId: "evt-1",
    type: "MATERIAL_RECEIVED" as const,
    occurredAt: 0,
    source: "receiving",
    correlationId: "STEEL-LOT-001",
    causationId: null,
    schemaVersion: 1 as const,
    payload: { quantity: 1 },
  };

  assert.equal(store.append(event), true);
  assert.equal(store.append(event), false);
  assert.deepEqual(
    store.map((entry) => entry.eventId),
    ["evt-1"],
  );
});
