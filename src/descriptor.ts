import { LOCATION_POSITIONS, factoryConfig, totalDemandPerShift } from "./factory.ts";
import { scenarios } from "./scenarios.ts";

/**
 * Tesisin değişmeyen tanımı: hatlar, istasyonlar, malzemeler, senaryolar.
 *
 * Bir koşunun durumu değil, o koşunun **üzerinde geçtiği fabrika**. Kare başına
 * yayınlanmaz; bir kez okunur.
 *
 * Burada duruyor çünkü iki yerden okunuyor: REST sunucusu ve — motoru tarayıcıda
 * koşturan yayın sürümünde — arayüzün kendisi. İki ayrı kopya olsaydı, biri
 * değiştiğinde yayındaki fabrika ile yereldeki sessizce ayrışırdı.
 */
export function factoryDescriptor() {
  return {
    lines: factoryConfig.lines.map((line) => ({
      id: line.id,
      model: line.model,
      route: line.route,
      reworkStationId: line.reworkStationId,
      wipCap: line.wipCap,
      demandPerShift: line.demandPerShift,
      taktTime: factoryConfig.shiftTicks / line.demandPerShift,
    })),
    plant: {
      maxReworkPasses: factoryConfig.maxReworkPasses,
      shiftTicks: factoryConfig.shiftTicks,
      demandPerShift: totalDemandPerShift(factoryConfig),
      taktTime: factoryConfig.shiftTicks / totalDemandPerShift(factoryConfig),
    },
    stations: factoryConfig.stations,
    materials: factoryConfig.materials,
    workOrders: factoryConfig.workOrders,
    shipmentPlan: factoryConfig.shipmentPlan,
    locations: LOCATION_POSITIONS,
    scenarios: Object.values(scenarios).map((scenario) => ({
      kind: scenario.kind,
      label: scenario.label,
      description: scenario.description,
      events: scenario.events,
    })),
  };
}

export type FactoryDescriptor = ReturnType<typeof factoryDescriptor>;
