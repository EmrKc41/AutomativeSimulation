"use client";

import { Meter, StatusPill } from "@/components/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { energy, minutes, percent } from "@/lib/format";
import { MACHINE_STATE, TONE, ratioTone } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Station detail, in the order the units travel.
 *
 * Utilisation is shown next to the queue on purpose: neither number means much
 * alone, and the pair is what tells an engineer whether a busy station is
 * actually the constraint.
 */
export function StationBoard({
  frame,
  config,
  onSelectStation,
  selectedStation,
}: {
  frame: FactoryFrame;
  config: FactoryDescriptor;
  onSelectStation: (machineId: string) => void;
  selectedStation: string | null;
}) {
  const order = [...config.line.route, config.line.reworkStationId];
  const rows = order
    .map((id) => frame.metrics.machines.find((machine) => machine.machineId === id))
    .filter((machine): machine is NonNullable<typeof machine> => machine !== undefined);
  const stationById = new Map(config.stations.map((station) => [station.id, station]));

  return (
    <section aria-label="İstasyon durumu" className="bg-card rounded-lg border">
      <h2 className="font-heading border-b px-3 py-2 text-xs font-semibold tracking-widest uppercase">
        İstasyonlar
      </h2>
      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8">İstasyon</TableHead>
              <TableHead className="h-8">Durum</TableHead>
              <TableHead className="h-8 text-right">Doluluk</TableHead>
              <TableHead className="h-8 text-right">Kullanılabilirlik</TableHead>
              <TableHead className="h-8 text-right">Kuyruk</TableHead>
              <TableHead className="h-8 text-right">Üretilen</TableHead>
              <TableHead className="h-8 text-right">Duruş</TableHead>
              <TableHead className="h-8 text-right">Enerji</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((machine) => {
              const state = MACHINE_STATE[machine.status];
              const station = stationById.get(machine.machineId);
              const capacity = station?.bufferCapacity ?? 0;
              const availabilityTone = ratioTone(machine.availability, 0.95);
              const selected = selectedStation === machine.machineId;

              return (
                <TableRow
                  key={machine.machineId}
                  onClick={() => onSelectStation(machine.machineId)}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectStation(machine.machineId);
                    }
                  }}
                  aria-selected={selected}
                  className={cn(
                    "focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none",
                    selected && "bg-accent/40",
                  )}
                >
                  <TableCell className="py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-heading font-medium">{machine.machineId}</span>
                      {machine.bottleneck ? (
                        <StatusPill tone="warn" label="Hattı tutuyor" compact />
                      ) : null}
                    </div>
                    <span className="text-muted-foreground text-[10px]">{machine.station}</span>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <StatusPill tone={state.tone} label={state.label} compact />
                  </TableCell>
                  <TableCell className="py-1.5 text-right">
                    <span className="tabular">{percent(machine.utilization, 0)}</span>
                    <Meter
                      value={machine.utilization}
                      tone={machine.bottleneck ? "warn" : "ok"}
                      label={`${machine.station} doluluk`}
                      className="mt-1"
                    />
                  </TableCell>
                  <TableCell
                    className={cn("tabular py-1.5 text-right", TONE[availabilityTone].text)}
                  >
                    {percent(machine.availability, 0)}
                  </TableCell>
                  <TableCell className="tabular py-1.5 text-right">
                    {machine.queueLength}
                    <span className="text-muted-foreground">/{capacity}</span>
                  </TableCell>
                  <TableCell className="tabular py-1.5 text-right">
                    {machine.producedCount}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular py-1.5 text-right",
                      machine.downtime > 0 && "text-status-critical",
                    )}
                  >
                    {minutes(machine.downtime)}
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground py-1.5 text-right">
                    {energy(machine.energyKwh)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
