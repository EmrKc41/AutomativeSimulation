"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AlertPanel } from "@/components/alert-panel";
import { AndonBanner } from "@/components/andon-banner";
import { ControlBar } from "@/components/control-bar";
import { CopilotPanel } from "@/components/copilot-panel";
import { EventTimeline } from "@/components/event-timeline";
import { KpiRail } from "@/components/kpi-rail";
import { FactoryViewport } from "@/components/factory-viewport";
import { LogisticsBoard } from "@/components/logistics-board";
import { StationBoard } from "@/components/station-board";
import { StationDetail } from "@/components/station-detail";
import { TraceSheet } from "@/components/trace-sheet";
import { WorkOrders } from "@/components/work-orders";
import { API_BASE, fetchConfig, sendCommand, type FactoryDescriptor } from "@/lib/api";
import type { Command } from "@/lib/contract";
import { useFactoryStream } from "@/lib/use-factory";

/**
 * The command centre shell.
 *
 * One screen, one authoritative source. Every panel below renders from the same
 * frame, so two panels can never disagree about the state of the plant — and
 * when the feed is down, the screen says so instead of showing the last frame
 * as though it were current.
 */
export function CommandCenter() {
  const { frame, events, history, connection, stale, lastFrameAt } = useFactoryStream();
  const [config, setConfig] = useState<FactoryDescriptor | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then(setConfig)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setConfigError(cause instanceof Error ? cause.message : "fabrika ana verisi yüklenemedi");
      });
    return () => controller.abort();
  }, []);

  // A one-second heartbeat purely for the "last update" label, kept separate
  // from the frame stream so it never re-renders the panels.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const runCommand = useCallback((command: Command) => {
    setPending(true);
    setCommandError(null);
    sendCommand(command)
      .then((result) => {
        if (!result.accepted) setCommandError(`Komut reddedildi: ${result.message}`);
      })
      .catch((cause: unknown) => {
        setCommandError(cause instanceof Error ? cause.message : "komut çalıştırılamadı");
      })
      .finally(() => setPending(false));
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        Above everything, including the control bar. A stop outranks every other
        thing on this screen, so it is placed where nothing can push it below
        the fold.
      */}
      {frame ? (
        <AndonBanner
          andon={frame.andon}
          simulatedTime={frame.simulatedTime}
          onFocusStation={setSelectedStation}
        />
      ) : null}
      <ControlBar
        frame={frame}
        lineId={config?.line.id ?? "—"}
        scenarios={config?.scenarios ?? []}
        connection={connection}
        stale={stale}
        lastFrameAt={lastFrameAt}
        now={now}
        onCommand={runCommand}
        onError={setCommandError}
        pending={pending}
      />

      {commandError ? (
        <p
          role="alert"
          className="border-status-critical/50 bg-status-critical/10 text-status-critical border-b px-4 py-1.5 text-xs"
        >
          {commandError}
        </p>
      ) : null}

      {configError || (connection !== "live" && frame === null) ? (
        <Disconnected message={configError} />
      ) : null}

      {frame === null || config === null ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          İkizden ilk kare bekleniyor…
        </div>
      ) : (
        <main className="grid flex-1 gap-2 p-2 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-2">
            <KpiRail metrics={frame.metrics} history={history} config={config} />
            <FactoryViewport
              frame={frame}
              config={config}
              onSelectStation={setSelectedStation}
              onSelectProduct={setSelectedProduct}
              selectedStation={selectedStation}
            />
            <StationBoard
              frame={frame}
              config={config}
              onSelectStation={setSelectedStation}
              selectedStation={selectedStation}
            />
            <div className="grid gap-2 lg:grid-cols-[20rem_minmax(0,1fr)]">
              <WorkOrders frame={frame} />
              <LogisticsBoard frame={frame} config={config} />
            </div>
          </div>

          <aside className="min-w-0 space-y-2 xl:sticky xl:top-[4.5rem] xl:self-start">
            <CopilotPanel
              simulatedTime={frame.simulatedTime}
              onCommand={runCommand}
              onSelectStation={setSelectedStation}
              onSelectProduct={setSelectedProduct}
            />
            <AlertPanel alerts={frame.openAlerts} onCommand={runCommand} />
            <EventTimeline events={events} config={config} onSelectProduct={setSelectedProduct} />
          </aside>
        </main>
      )}

      <TraceSheet
        productId={selectedProduct}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
      />
      {frame && config ? (
        <StationDetail
          machineId={selectedStation}
          frame={frame}
          config={config}
          onOpenChange={(open) => !open && setSelectedStation(null)}
          onSelectProduct={(productId) => {
            setSelectedStation(null);
            setSelectedProduct(productId);
          }}
        />
      ) : null}
    </div>
  );
}

function Disconnected({ message }: { message: string | null }) {
  return (
    <div className="border-status-critical/40 bg-status-critical/10 m-2 rounded-lg border p-4">
      <p className="text-status-critical flex items-center gap-2 text-sm font-medium">
        <AlertTriangle aria-hidden className="size-4" />
        Simülasyon sunucusuna bağlanılamıyor
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        Komuta merkezi çalışan ikizin istemcisidir; kendi başına hiçbir fabrika verisi tutmaz.
        Motoru başlatın, bu ekran otomatik olarak bağlanacaktır.
      </p>
      <pre className="bg-secondary mt-2 overflow-x-auto rounded p-2 text-[11px]">
        npm run server
      </pre>
      <p className="text-muted-foreground mt-1 text-[11px]">
        Beklenen adres: <span className="tabular">{API_BASE}</span>
        {message ? ` · ${message}` : ""}
      </p>
    </div>
  );
}
