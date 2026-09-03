import type {
  Analysis,
  Command,
  CommandResult,
  CopilotAnswer,
  Defect,
  FactoryEvent,
  Inspection,
  ProductUnit,
  ScenarioKind,
  Shipment,
  WorkOrder,
} from "@/lib/contract";

/**
 * Client for the twin's REST surface.
 *
 * The base URL is public by definition — it is a localhost simulation host, not
 * a credentialed service — so it is exposed through NEXT_PUBLIC_ and nothing
 * secret is ever read here.
 */
export const API_BASE = process.env.NEXT_PUBLIC_TWIN_API ?? "http://localhost:4000";

export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

/**
 * Motor nerede koşuyor?
 *
 * `yerel` — simülasyon **tarayıcıda**. Yayındaki sürüm böyle: sunucu yok, o
 * yüzden uyuyacak, süresi dolacak ya da ücret isteyecek bir şey de yok. Motor
 * çekirdeğinin hiçbir Node modülüne dokunmaması bunu mümkün kılıyor.
 *
 * `uzak` — bugünkü geliştirme akışı: ayrı bir motor süreci, REST + WebSocket.
 * Ortak durum gerektiğinde (birden fazla kişi aynı fabrikayı izleyecekse)
 * doğru olan bu.
 *
 * Derleme sırasında sabitleniyor; çalışırken değişmiyor.
 */
export const ENGINE_MODE: "yerel" | "uzak" =
  process.env.NEXT_PUBLIC_ENGINE_MODE === "local" ? "yerel" : "uzak";

export const IS_LOCAL_ENGINE = ENGINE_MODE === "yerel";

export interface ScenarioDescriptor {
  readonly kind: ScenarioKind;
  readonly label: string;
  readonly description: string;
}

/**
 * Tesisin tanımı — **motorun kendi tipi**.
 *
 * Burada elle yazılmış bir kopyası vardı ve sessizce yalan söylüyordu:
 * `workOrders` alanını çalışma-zamanı `WorkOrder` (released, completed,
 * scrapped…) diye tanımlıyordu, oysa `/api/config` yalnızca statik
 * `WorkOrderConfig` gönderiyor. Kimse o alanları okumadığı için hata yıllarca
 * görünmedi; motorun tipini paylaşınca derleyici anında yakaladı.
 *
 * Tek tanım, tek gerçek: sunucu ne gönderiyorsa arayüz onu bekliyor.
 */
import type { FactoryDescriptor } from "@twin/descriptor";

export type { FactoryDescriptor };

export interface TraceabilityBundle {
  readonly product: ProductUnit;
  readonly defects: readonly Defect[];
  readonly inspections: readonly Inspection[];
  readonly events: readonly FactoryEvent[];
  readonly shipment: Shipment | null;
  readonly workOrder: WorkOrder | null;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchConfig(signal?: AbortSignal): Promise<FactoryDescriptor> {
  if (IS_LOCAL_ENGINE) return (await import("@/lib/local-engine")).localConfig();
  return getJson<FactoryDescriptor>("/api/config", signal);
}

export async function fetchCopilotSuggestions(
  signal?: AbortSignal,
): Promise<{ questions: string[] }> {
  if (IS_LOCAL_ENGINE) return (await import("@/lib/local-engine")).localSuggestions();
  return getJson<{ questions: string[] }>("/api/copilot/suggestions", signal);
}

export async function fetchAnalytics(
  signal?: AbortSignal,
): Promise<{ simulatedTime: number; analyses: readonly Analysis[] }> {
  if (IS_LOCAL_ENGINE) return (await import("@/lib/local-engine")).localAnalytics();
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
  if (IS_LOCAL_ENGINE) return (await import("@/lib/local-engine")).localAsk(question);
  const response = await fetch(`${API_BASE}/api/copilot`, {
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
  const response = await fetch(`${API_BASE}/api/report/${kind}`);
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

export async function fetchTraceability(
  productId: string,
  signal?: AbortSignal,
): Promise<TraceabilityBundle> {
  if (IS_LOCAL_ENGINE) {
    const paket = (await import("@/lib/local-engine")).localTraceability(productId);
    if (!paket) throw new Error(`${productId} bu koşuda yok`);
    return paket;
  }
  return getJson<TraceabilityBundle>(`/api/products/${encodeURIComponent(productId)}`, signal);
}

/**
 * Commands go over REST rather than the socket so every action gets a
 * correlation ID back and a failed command surfaces as a rejection instead of
 * disappearing into the stream.
 */
export async function sendCommand(command: Command): Promise<CommandResult> {
  if (IS_LOCAL_ENGINE) return (await import("@/lib/local-engine")).localExecute(command);
  const response = await fetch(`${API_BASE}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await response.json()) as CommandResult | { error: string };
  if ("error" in body) throw new Error(body.error);
  return body;
}
