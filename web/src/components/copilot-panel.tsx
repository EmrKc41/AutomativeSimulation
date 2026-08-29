"use client";

import { CornerDownLeft, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { askCopilot, fetchCopilotSuggestions } from "@/lib/api";
import type { Command, CopilotAnswer, Evidence, Finding } from "@/lib/contract";
import { plantClock } from "@/lib/format";
import { TONE, type StatusTone } from "@/lib/status";

/** Intent names in the plant’s own words. */
const INTENT_LABEL: Record<CopilotAnswer["intent"], string> = {
  STATUS: "durum",
  BOTTLENECK: "hattı tutan istasyon",
  OEE_LOSS: "OEE kaybı",
  SCHEDULE: "termin",
  MACHINE_RISK: "arıza riski",
  QUALITY: "kalite",
  MATERIAL: "malzeme",
  SHIPMENT: "sevkiyat",
  TRACE: "araç geçmişi",
  UNKNOWN: "bilinmiyor",
};
import { cn } from "@/lib/utils";

/**
 * The copilot.
 *
 * It answers from the run's own record, and the panel is built to make that
 * checkable: every finding shows the evidence it rests on, and evidence that
 * names a machine or a unit opens that machine or unit. An answer you cannot
 * audit is an answer a plant manager should not act on.
 *
 * When the copilot proposes a change it renders a button, not an action. The
 * command is executed only if a human presses it.
 */
export function CopilotPanel({
  simulatedTime,
  onCommand,
  onSelectStation,
  onSelectProduct,
}: {
  simulatedTime: number;
  onCommand: (command: Command) => void;
  onSelectStation: (machineId: string) => void;
  onSelectProduct: (productId: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCopilotSuggestions(controller.signal)
      .then((result) => setSuggestions(result.questions))
      .catch(() => {
        /* Suggestions are a convenience; the input works without them. */
      });
    return () => controller.abort();
  }, []);

  const submit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setPending(true);
    setError(null);
    askCopilot(trimmed)
      .then(setAnswer)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "asistan yanıt vermedi");
      })
      .finally(() => setPending(false));
  }, []);

  // An answer describes the plant at the minute it was asked. Once the clock has
  // moved on, say so rather than letting it read as current.
  const staleBy = answer === null ? 0 : simulatedTime - answer.simulatedTime;

  return (
    <section aria-label="Fabrika asistanı" className="bg-card flex flex-col rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="font-heading flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase">
          <Sparkles aria-hidden className="size-3.5" />
          Asistan
        </h2>
        <span className="text-muted-foreground text-[10px]">yalnızca bu koşunun verisinden</span>
      </div>

      <form
        className="flex items-center gap-1.5 border-b px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit(question);
        }}
      >
        <label className="sr-only" htmlFor="copilot-question">
          Fabrikaya soru sor
        </label>
        <input
          id="copilot-question"
          ref={inputRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Neden hedefin gerisindeyiz?"
          maxLength={400}
          className="border-input bg-secondary focus-visible:ring-ring h-8 min-w-0 flex-1 rounded border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
        />
        <Button
          type="submit"
          size="sm"
          className="h-8 shrink-0 cursor-pointer px-2"
          disabled={pending || question.trim().length === 0}
          aria-label="Asistana sor"
        >
          {pending ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <CornerDownLeft aria-hidden className="size-3.5" />
          )}
        </Button>
      </form>

      {answer === null && suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-3 py-2">
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setQuestion(item);
                submit(item);
              }}
              className="border-border hover:bg-accent focus-visible:ring-ring cursor-pointer rounded-full border px-2 py-0.5 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-status-critical px-3 py-2 text-[11px]">
          {error}
        </p>
      ) : null}

      {answer ? (
        <ScrollArea className="h-[20rem]">
          <div className="space-y-3 px-3 py-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill
                tone={answer.answered ? "logistics" : "warn"}
                label={answer.answered ? INTENT_LABEL[answer.intent] : "cevaplanamıyor"}
                compact
              />
              <span className="text-muted-foreground tabular text-[10px]">
                soruldu {plantClock(answer.simulatedTime)}
              </span>
              {staleBy > 5 ? <StatusPill tone="idle" label={`${staleBy} dk önce`} compact /> : null}
            </div>

            <div>
              <h3 className="font-heading text-xs font-semibold">{answer.title}</h3>
              <p className="mt-0.5 leading-snug">{answer.summary}</p>
            </div>

            {answer.findings.map((finding, index) => (
              <FindingBlock
                key={`${finding.headline}-${index}`}
                finding={finding}
                onSelectStation={onSelectStation}
                onSelectProduct={onSelectProduct}
              />
            ))}

            {answer.recommendation ? (
              <div className="border-status-ok/40 bg-status-ok/10 rounded border p-2">
                <p className="text-muted-foreground text-[10px] tracking-widest uppercase">Öneri</p>
                <p className="mt-0.5 leading-snug">{answer.recommendation}</p>
              </div>
            ) : null}

            {answer.suggestedCommand ? (
              <div className="flex items-center justify-between gap-2 rounded border p-2">
                <p className="text-muted-foreground min-w-0 text-[10px]">
                  Asistan bunu denemek için bir senaryo öneriyor. Siz basmadan çalışmaz.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 shrink-0 cursor-pointer px-2 text-[10px]"
                  onClick={() => onCommand(answer.suggestedCommand as Command)}
                >
                  Çalıştır
                </Button>
              </div>
            ) : null}

            {answer.caveats.length > 0 ? (
              <ul className="text-muted-foreground space-y-0.5 border-t pt-2 text-[10px]">
                {answer.caveats.map((caveat) => (
                  <li key={caveat}>· {caveat}</li>
                ))}
              </ul>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setAnswer(null);
                setQuestion("");
                inputRef.current?.focus();
              }}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-pointer text-[10px] underline decoration-dotted underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
            >
              Başka bir şey sor
            </button>
          </div>
        </ScrollArea>
      ) : null}
    </section>
  );
}

const SEVERITY_TONE: Record<Finding["severity"], StatusTone> = {
  info: "logistics",
  warning: "warn",
  critical: "critical",
};

function FindingBlock({
  finding,
  onSelectStation,
  onSelectProduct,
}: {
  finding: Finding;
  onSelectStation: (machineId: string) => void;
  onSelectProduct: (productId: string) => void;
}) {
  const tone = SEVERITY_TONE[finding.severity];

  return (
    <div className={cn("rounded border p-2", TONE[tone].border, TONE[tone].bg)}>
      <p className={cn("font-medium", TONE[tone].text)}>{finding.headline}</p>
      <p className="mt-0.5 leading-snug">{finding.detail}</p>
      {finding.evidence.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {finding.evidence.map((evidence, index) => (
            <EvidenceChip
              key={`${evidence.kind}-${evidence.id}-${index}`}
              evidence={evidence}
              onSelectStation={onSelectStation}
              onSelectProduct={onSelectProduct}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Evidence that names something you can open, opens it. */
function EvidenceChip({
  evidence,
  onSelectStation,
  onSelectProduct,
}: {
  evidence: Evidence;
  onSelectStation: (machineId: string) => void;
  onSelectProduct: (productId: string) => void;
}) {
  const openable =
    evidence.kind === "machine" || (evidence.kind === "product" && evidence.id.startsWith("CAR-"));

  const content = (
    <>
      <span className="text-muted-foreground">{evidence.label}</span>
      <span className="tabular">{evidence.value}</span>
    </>
  );

  if (!openable) {
    return (
      <li className="bg-secondary/60 flex items-baseline gap-1 rounded px-1.5 py-0.5 text-[10px]">
        {content}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() =>
          evidence.kind === "machine" ? onSelectStation(evidence.id) : onSelectProduct(evidence.id)
        }
        className="bg-secondary/60 hover:bg-accent focus-visible:ring-ring flex cursor-pointer items-baseline gap-1 rounded px-1.5 py-0.5 text-left text-[10px] focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`${evidence.id} kaydını aç`}
      >
        {content}
      </button>
    </li>
  );
}
