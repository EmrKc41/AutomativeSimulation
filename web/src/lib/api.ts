import type {
  Analysis,
  Command,
  CommandResult,
  CopilotAnswer,
  Defect,
  FactoryEvent,
  Inspection,
  MaterialConfig,
  ProductUnit,
  ScenarioKind,
  Shipment,
  StationConfig,
  WorkOrder,
} from "@/lib/contract";

/** Port the engine listens on unless PORT is set for it. */
const ENGINE_PORT = 4000;

/**
 * Client for the twin's REST surface.
 *
 * The base URL is public by definition — it is a simulation host, not a
 * credentialed service — so it is exposed through NEXT_PUBLIC_ and nothing
 * secret is ever read here.
 *
 * With NEXT_PUBLIC_TWIN_API unset the engine is assumed to sit on the host that
 * served this page. A hard-coded "localhost" would point a phone or tablet at
 * itself, so the command centre would never reach the engine over the network;
 * reading the serving host keeps it usable from any device on the same network,
 * and still resolves to localhost when the page is opened on the host machine.
 */
export function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_TWIN_API;
  if (configured) return configured;
  if (typeof window === "undefined") return `http://localhost:${ENGINE_PORT}`;
  return `${window.location.protocol}//${window.location.hostname}:${ENGINE_PORT}`;
}

export function wsUrl(): string {
  return apiBase().replace(/^http/, "ws") + "/ws";
}

export interface ScenarioDescriptor {
  readonly kind: ScenarioKind;
  readonly label: string;
  readonly description: string;
}

export interface FactoryDescriptor {
  readonly line: {
    readonly id: string;
    readonly route: readonly string[];
    readonly reworkStationId: string;
    readonly wipCap: number;
    readonly maxReworkPasses: number;
    readonly taktTime: number;
    readonly shiftTicks: number;
    readonly demandPerShift: number;
  };
  readonly stations: readonly StationConfig[];
  readonly materials: readonly MaterialConfig[];
  readonly workOrders: readonly WorkOrder[];
  readonly locations: Readonly<Record<string, readonly [number, number]>>;
  readonly scenarios: readonly ScenarioDescriptor[];
}

export interface TraceabilityBundle {
  readonly product: ProductUnit;
  readonly defects: readonly Defect[];
  readonly inspections: readonly Inspection[];
  readonly events: readonly FactoryEvent[];
  readonly shipment: Shipment | null;
  readonly workOrder: WorkOrder | null;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return (await response.json()) as T;
}

export function fetchConfig(signal?: AbortSignal): Promise<FactoryDescriptor> {
  return getJson<FactoryDescriptor>("/api/config", signal);
}

export function fetchCopilotSuggestions(signal?: AbortSignal): Promise<{ questions: string[] }> {
  return getJson<{ questions: string[] }>("/api/copilot/suggestions", signal);
}

export function fetchAnalytics(
  signal?: AbortSignal,
): Promise<{ simulatedTime: number; analyses: Analysis[] }> {
  return getJson<{ simulatedTime: number; analyses: Analysis[] }>("/api/analytics", signal);
}

/**
 * Ask the twin a question.
 *
 * The answer is computed server-side from the run's own state; the browser
 * neither analyses nor phrases anything, so what it renders is what the factory
 * actually recorded.
 */
export async function askCopilot(question: string, signal?: AbortSignal): Promise<CopilotAnswer> {
  const response = await fetch(`${apiBase()}/api/copilot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
    signal: signal ?? null,
  });
  const body = (await response.json()) as CopilotAnswer | { error: string };
  if ("error" in body) throw new Error(body.error);
  return body;
}

/**
 * Fetch a generated report and hand it to the browser as a download.
 *
 * The file name comes from the server's Content-Disposition header, so the
 * plant clock stamped on it is the one the report was actually built at.
 */
export async function downloadReport(kind: "excel" | "pdf"): Promise<void> {
  const response = await fetch(`${apiBase()}/api/report/${kind}`);
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `rapor sunucusu ${response.status} döndü`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName =
    /filename="([^"]+)"/.exec(disposition)?.[1] ??
    (kind === "pdf" ? "vardiya-raporu.pdf" : "uretim-analizi.xlsx");

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function fetchTraceability(
  productId: string,
  signal?: AbortSignal,
): Promise<TraceabilityBundle> {
  return getJson<TraceabilityBundle>(`/api/products/${encodeURIComponent(productId)}`, signal);
}

/**
 * Commands go over REST rather than the socket so every action gets a
 * correlation ID back and a failed command surfaces as a rejection instead of
 * disappearing into the stream.
 */
export async function sendCommand(command: Command): Promise<CommandResult> {
  const response = await fetch(`${apiBase()}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await response.json()) as CommandResult | { error: string };
  if ("error" in body) throw new Error(body.error);
  return body;
}
