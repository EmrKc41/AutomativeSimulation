import { cn } from "@/lib/utils";
import { TONE, type StatusTone } from "@/lib/status";

/**
 * Status is always colour *and* words.
 *
 * Every state on this screen renders through here, so an operator who cannot
 * distinguish green from orange still reads "Blocked" rather than guessing at a
 * swatch. The dot is reinforcement, never the message.
 */
export function StatusPill({
  tone,
  label,
  className,
  compact = false,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
  compact?: boolean;
}) {
  const style = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border font-medium whitespace-nowrap",
        compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs",
        style.bg,
        style.border,
        style.text,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {label}
    </span>
  );
}

export function StatusDot({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE[tone].dot)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A labelled horizontal meter. `value` is a 0..1 ratio. */
export function Meter({
  value,
  tone,
  label,
  className,
}: {
  value: number;
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cn("bg-secondary h-1.5 w-full overflow-hidden rounded-full", className)}
      role="meter"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", TONE[tone].bar)}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
