"use client";

import { runAllAnalyses, type Analysis } from "@twin/analytics";
import { SUGGESTED_QUESTIONS, ask } from "@twin/copilot";
import { factoryDescriptor } from "@twin/descriptor";
import { SimulationRuntime } from "@twin/runtime";

import type { TraceabilityBundle } from "@/lib/api";
import type { Command, CommandResult, CopilotAnswer, FactoryFrame } from "@/lib/contract";

/**
 * Motorun **tarayıcıda** koşan hâli.
 *
 * Yayındaki sürümün sunucusu yok. Bunu yapabilmemizin sebebi bir tasarım
 * kararının ödülü: motor çekirdeği (`engine`, `state`, `metrics`, `analytics`,
 * `copilot`, `runtime`) hiçbir Node modülüne dokunmuyor. Ölçüldü — tek bağımlılık
 * `setInterval`, o da tarayıcıda var.
 *
 * Bu dosya sunucunun uçlarını birebir taklit etmez, **aynı işi yapan kaynağı**
 * çağırır: `/api/analytics` ne döndürüyorsa `runAllAnalyses` odur. Bir kopya
 * mantık yazmak, iki fabrikanın sessizce ayrışması demek olurdu.
 *
 * Ödünleşim açık: her ziyaretçi kendi bağımsız simülasyonunu görür, ortak durum
 * yoktur. Rapor üretimi ise burada **yok** — Excel ve PDF gömülü font ve logoyu
 * diskten okuyor, tarayıcıda dosya sistemi yok. Bunu gizlemek yerine söylüyoruz:
 * rapor düğmeleri yayın sürümünde görünmüyor.
 */

let runtime: SimulationRuntime | null = null;

/** Motoru ilk isteyende kur; sunucudakiyle aynı tohum ve senaryoyla. */
function engine(): SimulationRuntime {
  runtime ??= new SimulationRuntime({ seed: 42, scenario: "normal" });
  return runtime;
}

export function localConfig() {
  return factoryDescriptor();
}

export function localFrame(includeHistory = false): FactoryFrame {
  return engine().getFrame(includeHistory) as FactoryFrame;
}

export function localExecute(command: Command): CommandResult {
  return engine().execute(command as never) as CommandResult;
}

/** Kare aboneliği; sunucudaki WebSocket akışının yerel karşılığı. */
export function localSubscribe(listener: (frame: FactoryFrame) => void): () => void {
  return engine().subscribe((frame) => listener(frame as FactoryFrame));
}

export function localAnalytics(): { simulatedTime: number; analyses: readonly Analysis[] } {
  const state = engine().state;
  return { simulatedTime: state.time, analyses: runAllAnalyses(state) };
}

export function localSuggestions(): { questions: string[] } {
  return { questions: [...SUGGESTED_QUESTIONS] };
}

export function localAsk(question: string): CopilotAnswer {
  // Soru veridir: sabit bir niyet tablosuyla eşleştirilir, içeriği ne olursa
  // olsun talimat olarak yorumlanmaz. Sunucudaki kural burada da geçerli.
  return ask(engine().state, question) as CopilotAnswer;
}

/** Bir aracın bütün geçmişi; sunucudaki `/api/products/:id` ile aynı derleme. */
export function localTraceability(productId: string): TraceabilityBundle | null {
  const state = engine().state;
  const product = state.productIndex.get(productId);
  if (!product) return null;

  return {
    product,
    defects: state.defects.filter((defect) => defect.productId === productId),
    inspections: state.inspections.filter((inspection) => inspection.productId === productId),
    events: [...state.events].filter((event) => event.correlationId === productId),
    shipment: state.shipments.find((shipment) => shipment.id === product.shipmentId) ?? null,
    workOrder: state.workOrders.find((order) => order.id === product.workOrderId) ?? null,
  } as TraceabilityBundle;
}
