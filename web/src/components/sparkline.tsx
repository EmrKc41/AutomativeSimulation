"use client";

import { useId } from "react";

import { TONE, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * A trend line for one number.
 *
 * A KPI tile answers "what is it now"; an operator's next question is always
 * "and is that getting better or worse". The line answers that in the space a
 * tile already occupies, without a chart library and without axes nobody reads
 * at this size.
 *
 * It is not decoration: the last point is marked, the direction is stated in
 * words for a screen reader, and a flat or empty series draws nothing rather
 * than inventing a shape.
 */
export function Sparkline({
  values,
  tone = "ok",
  label,
  height = 28,
  className,
  /** Fix the vertical range — a ratio should be read against 0..1, not itself. */
  domain,
}: {
  values: readonly number[];
  tone?: StatusTone;
  label: string;
  height?: number;
  className?: string;
  domain?: readonly [number, number];
}) {
  const gradientId = useId();
  const points = values.filter((value) => Number.isFinite(value));

  if (points.length < 2) {
    return (
      <div
        className={cn("text-muted-foreground/60 flex items-end text-[9px]", className)}
        style={{ height }}
      >
        eğilim için yeterli veri yok
      </div>
    );
  }

  const width = 100;
  const [low, high] = domain ?? [Math.min(...points), Math.max(...points)];
  const span = high - low || 1;
  const step = width / (points.length - 1);

  const coordinates = points.map((value, index) => {
    const x = index * step;
    const y = height - ((value - low) / span) * height;
    return [x, Math.max(1, Math.min(height - 1, y))] as const;
  });

  const path = coordinates
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const area = `${path} L${width} ${height} L0 ${height} Z`;
  const last = coordinates.at(-1);
  const first = points[0] ?? 0;
  const latest = points.at(-1) ?? 0;
  const direction = latest > first ? "yükseliyor" : latest < first ? "düşüyor" : "yatay";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      aria-label={`${label}: son ${points.length} dakikada ${direction}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TONE[tone].hex} stopOpacity="0.28" />
          <stop offset="100%" stopColor={TONE[tone].hex} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={path}
        fill="none"
        stroke={TONE[tone].hex}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {last ? <circle cx={last[0]} cy={last[1]} r="1.8" fill={TONE[tone].hex} /> : null}
    </svg>
  );
}
