import { OPTIMIZERS, compareOptimizers } from "./optimizer-compare.ts";
import { scenarioKinds } from "./scenarios.ts";

/**
 * Run two planning policies against each other on the same seeds.
 *
 * The point of this command is that it can say **no**. A policy that only ever
 * gets shown the run it was tuned on will always look like an improvement; this
 * runs every scenario on several seeds and prints what actually happened,
 * including where the candidate is worse.
 *
 *   npm run optimize
 *   npm run optimize -- --taban=legacy --aday=nearest-vehicle
 *   npm run optimize -- --tohum=1,42,907,5150 --dakika=600
 */

const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith("--")) continue;
  const [key, value] = arg.slice(2).split("=");
  flags.set(key ?? "", value ?? "true");
}

const baselineName = flags.get("taban") ?? "legacy";
const candidateName = flags.get("aday") ?? "slack-aware";
const ticks = Number(flags.get("dakika") ?? 600);
const seeds = (flags.get("tohum") ?? "1,42,907,5150")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));

for (const [label, name] of [
  ["taban", baselineName],
  ["aday", candidateName],
] as const) {
  if (!(name in OPTIMIZERS)) {
    console.error(
      `Bilinmeyen ${label} politikası "${name}". Seçenekler: ${Object.keys(OPTIMIZERS).join(", ")}`,
    );
    process.exit(1);
  }
}
if (!Number.isInteger(ticks) || ticks < 1) {
  console.error("--dakika pozitif bir tam sayı olmalı");
  process.exit(1);
}
if (seeds.length === 0) {
  console.error("--tohum en az bir sayı içermeli");
  process.exit(1);
}

const makeBaseline = OPTIMIZERS[baselineName]!;
const makeCandidate = OPTIMIZERS[candidateName]!;

const number = new Intl.NumberFormat("tr-TR");
const signed = (value: number, digits = 0) =>
  (value > 0 ? "+" : "") +
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(value);

console.log(`\nPlanlama politikası karşılaştırması`);
console.log(`  taban : ${baselineName}`);
console.log(`  aday  : ${candidateName}`);
console.log(`  ${ticks} dakika × ${seeds.length} tohum × ${scenarioKinds.length} senaryo\n`);

const head = [
  "senaryo".padEnd(19),
  "üretim".padStart(8),
  "geciken".padStart(9),
  "gecikme dk".padStart(12),
  "en kötü dk".padStart(12),
  "AGV yol dk".padStart(12),
];
console.log(head.join(" "));
console.log("-".repeat(head.join(" ").length));

const totals = { output: 0, late: 0, lateness: 0, worst: 0, travel: 0 };
const baseTotals = { lateness: 0, worst: 0 };

for (const kind of scenarioKinds) {
  const row = { output: 0, late: 0, lateness: 0, worst: 0, travel: 0 };
  let baseLateness = 0;
  let baseWorst = 0;

  for (const seed of seeds) {
    const result = compareOptimizers(makeBaseline(), makeCandidate(), kind, ticks, seed);
    row.output += result.delta.output;
    row.late += result.delta.lateOrders;
    row.lateness += result.delta.totalLatenessMinutes;
    // Worst-case is a maximum, not a sum: averaging it across seeds keeps it
    // meaningful, where adding it would just grow with the number of seeds.
    row.worst += result.delta.maxLatenessMinutes;
    row.travel += result.delta.agvTravelMinutes;
    baseLateness += result.baseline.totalLatenessMinutes;
    baseWorst += result.baseline.maxLatenessMinutes;
  }

  totals.output += row.output;
  totals.late += row.late;
  totals.lateness += row.lateness;
  totals.worst += row.worst;
  totals.travel += row.travel;
  baseTotals.lateness += baseLateness;
  baseTotals.worst += baseWorst;

  console.log(
    [
      kind.padEnd(19),
      signed(row.output).padStart(8),
      signed(row.late).padStart(9),
      signed(row.lateness).padStart(12),
      signed(row.worst / seeds.length, 1).padStart(12),
      signed(row.travel).padStart(12),
    ].join(" "),
  );
}

console.log("-".repeat(head.join(" ").length));
console.log(
  [
    "TOPLAM".padEnd(19),
    signed(totals.output).padStart(8),
    signed(totals.late).padStart(9),
    signed(totals.lateness).padStart(12),
    signed(totals.worst / seeds.length, 1).padStart(12),
    signed(totals.travel).padStart(12),
  ].join(" "),
);

console.log(
  `\nTaban gecikme toplamı ${number.format(baseTotals.lateness)} dk, ` +
    `en kötü iş emri ortalama ${number.format(Math.round(baseTotals.worst / seeds.length))} dk.`,
);

// A verdict, stated plainly. "Late orders" alone is a trap: splitting one badly
// late order into two slightly late ones makes the count worse and the plant
// better, so the total and the worst case decide it.
const better = totals.lateness < 0 && totals.worst <= 0 && totals.output >= 0;
const worse = totals.lateness > 0 || totals.output < 0;
console.log(
  better
    ? `\nSonuç: "${candidateName}" tabandan iyi — gecikme ${signed(totals.lateness)} dk, üretim kaybı yok.`
    : worse
      ? `\nSonuç: "${candidateName}" tabandan KÖTÜ. Bu politika kullanılmamalı.`
      : `\nSonuç: fark yok. "${candidateName}" tabandan ayırt edilemiyor.`,
);
console.log("");
