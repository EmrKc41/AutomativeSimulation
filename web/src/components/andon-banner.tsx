"use client";

import { Bell, BellOff, OctagonX, PhoneCall, Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { BRAND } from "@twin/brand";

import { Button } from "@/components/ui/button";
import type { AndonState } from "@/lib/contract";
import { minutes, plantClock } from "@/lib/format";

/**
 * The andon banner.
 *
 * A stopped station is not one more row in an alert list. In a plant the rule
 * is absolute and the same for everyone regardless of rank — **Dur, Haber Ver,
 * Bekle** — so the screen states it that way: it takes the top of the page, it
 * cannot be dismissed while the stop is open, and it says the three words in
 * order rather than describing them.
 *
 * It closes by itself when the machine comes back, and never before. There is
 * deliberately no "acknowledge" button: acknowledging a stop is something a
 * person does on the floor, not something a dashboard can record on their
 * behalf.
 */
export function AndonBanner({
  andon,
  simulatedTime,
  onFocusStation,
}: {
  andon: AndonState;
  simulatedTime: number;
  onFocusStation: (machineId: string) => void;
}) {
  const [alerting, setAlerting] = useState(false);
  // Read only after the operator asks for alerts: touching `Notification`
  // during render would differ between the server pass and hydration.
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const notifiedFor = useRef<string | null>(null);

  /**
   * A two-tone horn, synthesised rather than shipped as a file.
   *
   * Browsers refuse to play audio the user has not asked for, and a klaxon that
   * fires unannounced would be worse than none — so this only runs after the
   * operator turns alerts on.
   */
  const sound = useCallback(() => {
    try {
      audioRef.current ??= new AudioContext();
      const context = audioRef.current;
      if (context.state === "suspended") void context.resume();
      const now = context.currentTime;
      for (const [index, frequency] of [880, 660].entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.28);
        gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.28 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.28 + 0.24);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + index * 0.28);
        oscillator.stop(now + index * 0.28 + 0.26);
      }
    } catch {
      // No audio device or a blocked context: the banner is still on screen.
    }
  }, []);

  const enableAlerts = useCallback(() => {
    setAlerting(true);
    sound();
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
      return;
    }
    if (Notification.permission === "default") {
      void Notification.requestPermission().then(setPermission);
    } else {
      setPermission(Notification.permission);
    }
  }, [sound]);

  const first = andon.stops[0];
  const stopKey = andon.stops.map((stop) => `${stop.machineId}@${stop.since}`).join("|");

  // Fire once per distinct stop, not once per frame.
  useEffect(() => {
    if (!andon.active || !first) {
      notifiedFor.current = null;
      return;
    }
    if (notifiedFor.current === stopKey) return;
    notifiedFor.current = stopKey;

    if (!alerting) return;
    sound();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("DURUŞ — Hat durdu", {
        body: `${first.station} durdu. Dur, haber ver, bekle.`,
        tag: "andon",
        requireInteraction: true,
      });
    }
  }, [alerting, andon.active, first, sound, stopKey]);

  // A background tab has to show it too.
  useEffect(() => {
    const base = `${BRAND.full} — LINE-01`;
    document.title = andon.active && first ? `DURUŞ · ${first.station} — ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [andon.active, first]);

  if (!andon.active || !first) return null;

  const totalHeld = andon.stops.filter((stop) => stop.heldProductId !== null).length;

  return (
    <section
      // `alert` so a screen reader announces it the moment it appears.
      role="alert"
      aria-live="assertive"
      aria-label="Hat duruşu"
      className="border-status-critical bg-status-critical/15 sticky top-0 z-50 border-b-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <span className="bg-status-critical text-background flex items-center gap-2 rounded px-2.5 py-1 text-sm font-bold tracking-widest">
          <OctagonX aria-hidden className="size-4" />
          DURUŞ
        </span>

        <div className="min-w-0">
          <p className="text-status-critical text-sm font-semibold">
            {andon.stops.length === 1
              ? `${first.station} durdu`
              : `${andon.stops.length} istasyon durdu`}
          </p>
          <p className="text-muted-foreground text-[11px]">
            {plantClock(first.since)} itibarıyla · {minutes(first.elapsedMinutes)} geçti
            {first.estimatedRemaining > 0
              ? ` · tahmini ${minutes(first.estimatedRemaining)} kaldı`
              : ""}
            {totalHeld > 0 ? ` · ${totalHeld} araç makinede bekliyor` : ""}
          </p>
        </div>

        {/* The rule, in the order it is carried out. */}
        <ol className="flex items-stretch gap-1.5">
          {[
            { step: "DUR", detail: "Hattı çalıştırma", icon: OctagonX },
            { step: "HABER VER", detail: "Amirine bildir", icon: PhoneCall },
            { step: "BEKLE", detail: "Onay gelmeden başlama", icon: Timer },
          ].map(({ step, detail, icon: Icon }, index) => (
            <li
              key={step}
              className="border-status-critical/50 bg-background/60 flex items-center gap-2 rounded border px-2.5 py-1"
            >
              <span className="text-status-critical text-[10px] font-bold">{index + 1}</span>
              <Icon aria-hidden className="text-status-critical size-3.5" />
              <span className="leading-tight">
                <span className="block text-[11px] font-bold tracking-wide">{step}</span>
                <span className="text-muted-foreground block text-[9px]">{detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="border-status-critical/60 h-8 cursor-pointer"
            onClick={() => onFocusStation(first.machineId)}
          >
            İstasyonu göster
          </Button>
          <Button
            size="sm"
            variant={alerting ? "secondary" : "default"}
            className="h-8 cursor-pointer"
            onClick={alerting ? () => setAlerting(false) : enableAlerts}
            aria-pressed={alerting}
            title={
              permission === "unsupported"
                ? "Bu tarayıcı masaüstü bildirimi desteklemiyor; sesli uyarı yine çalışır."
                : undefined
            }
          >
            {alerting ? (
              <BellOff aria-hidden className="size-4" />
            ) : (
              <Bell aria-hidden className="size-4" />
            )}
            {alerting ? "Uyarı açık" : "Uyarıları aç"}
          </Button>
        </div>
      </div>

      {andon.stops.length > 1 ? (
        <ul className="border-status-critical/30 flex flex-wrap gap-x-4 gap-y-0.5 border-t px-4 py-1 text-[10px]">
          {andon.stops.map((stop) => (
            <li key={stop.machineId}>
              <button
                type="button"
                onClick={() => onFocusStation(stop.machineId)}
                className="focus-visible:ring-ring cursor-pointer underline decoration-dotted underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
              >
                {stop.station}
              </button>
              <span className="text-muted-foreground">
                {" "}
                · {minutes(stop.elapsedMinutes)} · {plantClock(stop.since)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-muted-foreground border-status-critical/30 border-t px-4 py-1 text-[10px]">
        Bu uyarı, istasyon tekrar çalışana kadar kapanmaz. Kapatma düğmesi yoktur: duruşu onaylamak
        sahada yapılan bir iştir, ekranda değil. Simülasyondaki bu duruş, gerçek hattaki refleksi
        görünür kılmak için buradadır.
        <span className="tabular"> {simulatedTime} dk</span>
      </p>
    </section>
  );
}
