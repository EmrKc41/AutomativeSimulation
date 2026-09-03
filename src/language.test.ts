import assert from "node:assert/strict";
import test from "node:test";

import {
  ALERT_TEXT,
  DEFECT_TEXT,
  EVENT_TEXT,
  MACHINE_STATUS_TEXT,
  PAYLOAD_TEXT,
  PRODUCT_STATUS_TEXT,
  SEVERITY_TEXT,
  SHIPMENT_STATUS_TEXT,
} from "./labels.ts";
import { factoryConfig } from "./factory.ts";
import { scenarioKinds } from "./scenarios.ts";
import { runScenario } from "./simulation.ts";

/**
 * The product is Turkish, and that is a property of the running system rather
 * than of any one file.
 *
 * Two rules are checked here, both of which came from the user directly:
 *
 * 1. **Nothing an operator reads may be English.** The Turkish pass translated
 *    the alert *codes* but missed the alert *bodies*, so the screen showed
 *    "Paint Shop 01 is constraining the line" for weeks of work. A grep cannot
 *    catch that — the strings are built at runtime from templates — so the
 *    engine is actually run and every message it produces is inspected.
 *
 * 2. **"Darboğaz" and its relatives never appear.** Turkish factories do not
 *    use those words; the user was explicit that they had to go entirely. They
 *    remain valid *input* to the assistant, which is a different direction and
 *    is tested in `copilot.test.ts`.
 */

/** Function words that only occur in English prose, not in Turkish or in IDs. */
const ENGLISH_MARKERS =
  /\b(is|are|was|were|has|have|had|the|and|of|to|at|for|with|from|cannot|units?|ticks?|line side|constrain\w*|utilisation|utilization|downstream|upstream|rework passes|inspection|failed|unavailable|scrapped|routed|estimated|waiting|down for)\b/i;

/**
 * Words the user asked to be removed from every operator-facing surface.
 *
 * "kısıt" is matched with a word boundary on purpose: "kısıtlı" and "kısıtlama"
 * are the same objection, but "kısa" and "kısım" are ordinary words.
 */
const BANNED = /\b(darboğaz|darbogaz|kısıt\w*|kisit\w*|bottleneck)\b/i;

/**
 * Strip the parts of a message that are legitimately not Turkish words: unit
 * codes, station codes, work-order numbers. Those are asset identifiers and a
 * real plant keeps them short and language-free on the equipment plate.
 */
function prose(message: string): string {
  return message
    .replace(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g, " ") // CAR-2026-000007, WO-2026-001, PRESS-01
    .replace(/\b[A-Z]{2,}\b/g, " "); // OEE, WIP, FIFO
}

/**
 * Every distinct alert message the engine can produce, mapped to its code.
 *
 * A single run does not raise every alert: scrap needs two failed rework passes
 * and a raw-store shortage needs the store to actually run dry. Sweeping
 * scenarios and seeds gets every code raised at least once.
 */
function sweepAlerts(): Map<string, string> {
  const seen = new Map<string, string>();
  for (const kind of scenarioKinds) {
    for (const seed of [1, 42, 907, 5150]) {
      for (const alert of runScenario({ kind, ticks: 600, seed }).alerts) {
        seen.set(alert.message, alert.code);
      }
    }
  }
  return seen;
}

test("no alert an operator can see is written in English", () => {
  const seen = sweepAlerts();
  assert.ok(seen.size > 0, "tarama hiç alarm üretmedi; test bir şey doğrulamıyor");

  const english: string[] = [];
  const banned: string[] = [];
  for (const message of seen.keys()) {
    if (ENGLISH_MARKERS.test(prose(message))) english.push(message);
    if (BANNED.test(message)) banned.push(message);
  }

  assert.deepEqual(english, [], `İngilizce alarm metni:\n  ${english.join("\n  ")}`);
  assert.deepEqual(banned, [], `sahada kullanılmayan kelime:\n  ${banned.join("\n  ")}`);
});

test("every alert code the engine can raise was actually exercised", () => {
  const raised = new Set(sweepAlerts().values());

  // Without this the language test above passes vacuously for any code the
  // sweep happens not to trigger.
  for (const code of Object.keys(ALERT_TEXT)) {
    assert.ok(raised.has(code), `${code} alarmı hiç üretilmedi; dil kontrolü onu kapsamıyor`);
  }
});

test("the shared glossary has a Turkish word for everything it maps", () => {
  // Two shapes live in the glossary: a plain label, and a label plus the
  // sentence that explains what the state means to an operator. Both are read
  // off the screen, so both are checked.
  const tables = {
    ALERT_TEXT,
    EVENT_TEXT,
    DEFECT_TEXT,
    SEVERITY_TEXT,
    PAYLOAD_TEXT,
    MACHINE_STATUS_TEXT,
    PRODUCT_STATUS_TEXT,
    SHIPMENT_STATUS_TEXT,
  };

  for (const [name, table] of Object.entries(tables)) {
    for (const [key, value] of Object.entries(table)) {
      const parts =
        typeof value === "string" ? [value] : [value.label, value.meaning].filter(Boolean);
      assert.ok(parts.length > 0, `${name}.${key} boş`);

      for (const part of parts) {
        assert.equal(typeof part, "string", `${name}.${key} bir metin olmalı`);
        assert.ok(part.trim().length > 0, `${name}.${key} boş`);
        // An untranslated entry usually shows up as the enum name echoed back.
        assert.notEqual(part, key, `${name}.${key} çevrilmemiş, kodun kendisi dönüyor`);
        assert.ok(!BANNED.test(part), `${name}.${key} yasaklı kelime içeriyor: ${part}`);
        assert.ok(
          !ENGLISH_MARKERS.test(prose(part)),
          `${name}.${key} İngilizce görünüyor: ${part}`,
        );
      }
    }
  }
});

test("every payload key the engine emits has a Turkish word for it", () => {
  const keys = new Set<string>();
  for (const kind of scenarioKinds) {
    for (const seed of [1, 42, 907]) {
      for (const event of runScenario({ kind, ticks: 600, seed }).events) {
        for (const key of Object.keys(event.payload ?? {})) keys.add(key);
      }
    }
  }

  // The event log is on screen, in the Excel workbook and in the shift PDF.
  // An unmapped key leaks the engine's own vocabulary into a production
  // meeting: "plannedDeparture=56" means nothing to the people reading it.
  const missing = [...keys].filter((key) => !(key in PAYLOAD_TEXT)).sort();
  assert.deepEqual(missing, [], `sözlükte karşılığı olmayan alan: ${missing.join(", ")}`);
});

/**
 * Ekrandaki ad ile kimlik aynı istasyonu anlatmalı.
 *
 * Üç hat şablondan üretiliyor ve adın numarası bir dönem **hat** numarasından
 * yazılıyordu: panoda "Gövde Kaynak 01" görünüyor, kimliği `WELD-04` oluyordu.
 * Aynı istasyonu iki farklı numarayla anan bir pano, sahada telsizle konuşan
 * iki kişiyi karşı karşıya getirir.
 */
test("a station's name and its id never disagree about the number", () => {
  for (const station of factoryConfig.stations) {
    const kimlikNo = /(\d+)$/.exec(station.id)?.[1];
    const adNo = /(\d+)$/.exec(station.name)?.[1];

    assert.equal(
      adNo,
      kimlikNo,
      `${station.id} istasyonu ekranda "${station.name}" diye görünüyor`,
    );
  }
});

test("no two stations share a display name", () => {
  const adlar = factoryConfig.stations.map((station) => station.name);
  assert.equal(
    new Set(adlar).size,
    adlar.length,
    `aynı adı taşıyan istasyonlar var: ${adlar.join(", ")}`,
  );
});
