"use client";

import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { downloadReport } from "@/lib/api";

/**
 * Report downloads.
 *
 * Both documents are produced server-side from the run's own record, so a
 * report always describes the plant at the minute it was asked for — not a
 * re-derivation from whatever the browser happened to have cached.
 */
export function ReportButtons({ onError }: { onError: (message: string) => void }) {
  const [pending, setPending] = useState<"excel" | "pdf" | null>(null);

  const download = (kind: "excel" | "pdf") => {
    setPending(kind);
    downloadReport(kind)
      .catch((cause: unknown) => {
        onError(cause instanceof Error ? cause.message : "rapor indirilemedi");
      })
      .finally(() => setPending(null));
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground text-[10px] tracking-widest uppercase">Rapor</span>
      <Button
        size="sm"
        variant="outline"
        className="h-8 cursor-pointer"
        disabled={pending !== null}
        onClick={() => download("excel")}
        aria-label="Üretim analizi Excel dosyasını indir"
      >
        {pending === "excel" ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <FileSpreadsheet aria-hidden className="size-4" />
        )}
        Excel
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8 cursor-pointer"
        disabled={pending !== null}
        onClick={() => download("pdf")}
        aria-label="Vardiya durum raporunu PDF olarak indir"
      >
        {pending === "pdf" ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <FileText aria-hidden className="size-4" />
        )}
        PDF
      </Button>
    </div>
  );
}
