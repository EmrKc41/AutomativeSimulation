/**
 * Presentation helpers.
 *
 * One tick is one minute of plant time, which makes the configured 480-tick
 * shift exactly eight hours and an 8-tick takt exactly eight minutes per
 * vehicle. Times are shown as plant clock, never as raw tick counts, because
 * that is the unit an operator thinks in.
 *
 * Numbers are formatted for tr-TR: a Turkish plant reads 84,9% and 1.250, and
 * an English decimal point in a Turkish sentence is a small but constant
 * friction on a screen someone stares at all shift.
 */

const LOCALE = "tr-TR";

function nf(digits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function percent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `%${nf(digits).format(value * 100)}`;
}

export function decimal(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return nf(digits).format(value);
}

export function integer(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(LOCALE).format(Math.round(value));
}

/** Elapsed plant time as HH:MM since the start of the run. */
export function plantClock(ticks: number): string {
  const hours = Math.floor(ticks / 60);
  const minutes = ticks % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** A duration in ticks, written the way a shift report would write it. */
export function duration(ticks: number): string {
  if (!Number.isFinite(ticks)) return "—";
  if (ticks < 60) return `${Math.round(ticks)} dk`;
  const hours = Math.floor(ticks / 60);
  const minutes = Math.round(ticks % 60);
  return minutes === 0 ? `${hours} sa` : `${hours} sa ${minutes} dk`;
}

/** Minutes, the unit the plant counts downtime and cycle time in. */
export function minutes(ticks: number): string {
  if (!Number.isFinite(ticks)) return "—";
  return `${integer(ticks)} dk`;
}

export function energy(kwh: number): string {
  if (kwh >= 1000) return `${decimal(kwh / 1000, 2)} MWh`;
  return `${decimal(kwh, 1)} kWh`;
}

export function relativeAge(milliseconds: number): string {
  if (milliseconds < 1500) return "az önce";
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1000)} sn önce`;
  return `${Math.round(milliseconds / 60_000)} dk önce`;
}
