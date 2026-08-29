import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import { runAllAnalyses } from "./analytics.ts";
import { SUGGESTED_QUESTIONS, ask } from "./copilot.ts";
import type { Command } from "./domain.ts";
import { LOCATION_POSITIONS, factoryConfig } from "./factory.ts";
import { BRAND } from "./brand.ts";
import { buildPdf, buildReportModel, buildWorkbook, reportFileName } from "./report/index.ts";
import { SimulationRuntime } from "./runtime.ts";
import { isScenarioKind, scenarios } from "./scenarios.ts";

/**
 * REST + WebSocket host for one live factory.
 *
 * REST serves stable resources and accepts commands; WebSocket streams one
 * versioned frame per tick. The split matters: a client that misses frames can
 * always recover by re-reading a snapshot, and a command always returns a
 * correlation ID rather than mutating state behind the caller's back.
 */

const PORT = Number(process.env.PORT ?? 4000);
const MAX_BODY_BYTES = 64 * 1024;

const runtime = new SimulationRuntime({ seed: 42, scenario: "normal" });

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  response.end(payload);
}

/** Serve a generated document as a download rather than as JSON. */
function sendFile(
  response: ServerResponse,
  body: Buffer,
  contentType: string,
  fileName: string,
): void {
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": String(body.length),
    // File names are kept ASCII on purpose: a Turkish name would need RFC 5987
    // encoding and still break on some older clients that have to open it.
    "content-disposition": `attachment; filename="${fileName}"`,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "content-disposition",
  });
  response.end(body);
}

/**
 * Reports are built one at a time.
 *
 * A workbook takes about 200 ms of solid CPU, and this process also runs the
 * factory clock. Measured at 16× speed, ten concurrent report requests froze
 * the tick loop for 1.55 seconds — every viewer's screen stopped, and anyone
 * could cause it by holding down the download button. Serialising turns that
 * worst case back into roughly one report's worth of pause.
 *
 * The queue is capped rather than unbounded: past a few waiting requests the
 * honest answer is "not now", not a download that arrives a minute later
 * describing a plant that has moved on.
 */
const MAX_REPORT_QUEUE = 4;
let reportsWaiting = 0;
let reportChain: Promise<unknown> = Promise.resolve();

function queueReport<T>(build: () => Promise<T>): Promise<T> {
  // Each request chains onto the last, and a failure must not break the chain
  // for everyone behind it.
  const next = reportChain.then(build, build);
  reportChain = next.catch(() => undefined);
  return next;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Validate the request body into a command.
 *
 * The body arrives from a browser, so it is data, not instructions: an unknown
 * shape is rejected here rather than being coerced into something executable.
 */
function parseCommand(body: unknown): Command | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const type = record["type"];
  const scenario = typeof record["scenario"] === "string" ? record["scenario"] : undefined;
  const seed = typeof record["seed"] === "number" ? record["seed"] : undefined;

  switch (type) {
    case "PLAY":
    case "PAUSE":
      return { type };
    case "STEP":
      return { type, ticks: typeof record["ticks"] === "number" ? record["ticks"] : 1 };
    case "SET_SPEED":
      return typeof record["speed"] === "number" ? { type, speed: record["speed"] } : null;
    case "RESET":
      return {
        type,
        ...(scenario !== undefined && isScenarioKind(scenario) ? { scenario } : {}),
        ...(seed !== undefined ? { seed } : {}),
      };
    case "LOAD_SCENARIO":
      if (scenario === undefined || !isScenarioKind(scenario)) return null;
      return { type, scenario, ...(seed !== undefined ? { seed } : {}) };
    case "ACKNOWLEDGE_ALERT":
      return typeof record["alertId"] === "string" ? { type, alertId: record["alertId"] } : null;
    default:
      return null;
  }
}

function factoryDescriptor() {
  return {
    line: {
      id: factoryConfig.lineId,
      route: factoryConfig.route,
      reworkStationId: factoryConfig.reworkStationId,
      wipCap: factoryConfig.wipCap,
      maxReworkPasses: factoryConfig.maxReworkPasses,
      taktTime: factoryConfig.shiftTicks / factoryConfig.demandPerShift,
      shiftTicks: factoryConfig.shiftTicks,
      demandPerShift: factoryConfig.demandPerShift,
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

/** Everything known about one unit, for the traceability drill-down. */
function traceability(productId: string) {
  const state = runtime.state;
  const product = state.productIndex.get(productId);
  if (!product) return null;
  return {
    product,
    defects: state.defects.filter((defect) => defect.productId === productId),
    inspections: state.inspections.filter((inspection) => inspection.productId === productId),
    events: [...state.events].filter((event) => event.correlationId === productId),
    shipment: state.shipments.find((shipment) => shipment.id === product.shipmentId) ?? null,
    workOrder: state.workOrders.find((order) => order.id === product.workOrderId) ?? null,
  };
}

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    send(response, 204, {});
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "GET") {
    switch (true) {
      case path === "/api/health":
        send(response, 200, {
          ok: true,
          simulationId: runtime.simulationId,
          status: runtime.status,
          speed: runtime.speed,
          simulatedTime: runtime.state.time,
        });
        return;

      case path === "/api/config":
        send(response, 200, factoryDescriptor());
        return;

      case path === "/api/frame": {
        // A REST caller has no previous frame, so a "delta since last publish"
        // would be meaningless. It gets the read model without events by
        // default, and reads history from /api/events.
        if (url.searchParams.get("events") === "all") {
          send(response, 200, runtime.getFrame(true));
          return;
        }
        send(response, 200, { ...runtime.getFrame(true), events: [] });
        return;
      }

      case path === "/api/analytics":
        send(response, 200, {
          simulatedTime: runtime.state.time,
          analyses: runAllAnalyses(runtime.state),
        });
        return;

      case path === "/api/copilot/suggestions":
        send(response, 200, { questions: SUGGESTED_QUESTIONS });
        return;

      case path === "/api/report/excel":
      case path === "/api/report/pdf": {
        const wantsPdf = path.endsWith("/pdf");
        if (reportsWaiting >= MAX_REPORT_QUEUE) {
          send(response, 429, {
            error: "Şu anda çok fazla rapor üretiliyor. Birkaç saniye sonra tekrar deneyin.",
          });
          return;
        }
        reportsWaiting += 1;
        void queueReport(() => {
          // The model is read inside the queue, not outside it: a report should
          // describe the plant at the moment it is built, not the moment it was
          // asked for.
          const model = buildReportModel(runtime.state, { simulationId: runtime.simulationId });
          const build = wantsPdf ? buildPdf(model) : buildWorkbook(model);
          return build.then((body) => ({ body, model }));
        })
          .then(({ body, model }) => {
            sendFile(
              response,
              body,
              wantsPdf
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              reportFileName(
                wantsPdf ? "pdf" : "xlsx",
                model.lineId,
                model.scenario,
                model.simulatedMinutes,
              ),
            );
          })
          .catch((error: unknown) => {
            send(response, 500, {
              error: error instanceof Error ? error.message : "rapor üretilemedi",
            });
          })
          .finally(() => {
            reportsWaiting -= 1;
          });
        return;
      }

      case path === "/api/snapshot":
        send(response, 200, runtime.getSnapshot());
        return;

      case path === "/api/events": {
        const since = Number(url.searchParams.get("since") ?? 0);
        const limit = Math.min(2000, Number(url.searchParams.get("limit") ?? 200));
        const type = url.searchParams.get("type");
        const correlationId = url.searchParams.get("correlationId");
        const matches = [...runtime.state.events].filter(
          (event) =>
            event.occurredAt >= since &&
            (type === null || event.type === type) &&
            (correlationId === null || event.correlationId === correlationId),
        );
        send(response, 200, { total: matches.length, events: matches.slice(-limit) });
        return;
      }

      case path.startsWith("/api/products/"): {
        const productId = decodeURIComponent(path.slice("/api/products/".length));
        const trace = traceability(productId);
        if (!trace) {
          send(response, 404, { error: `unknown product "${productId}"` });
          return;
        }
        send(response, 200, trace);
        return;
      }

      default:
        send(response, 404, { error: "not found", path });
        return;
    }
  }

  if (request.method === "POST" && path === "/api/copilot") {
    void readJson(request)
      .then((body) => {
        // The question is treated strictly as text to match against a fixed
        // intent table — never as an instruction, whatever it says.
        const question =
          typeof body === "object" && body !== null
            ? (body as Record<string, unknown>)["question"]
            : undefined;
        if (typeof question !== "string" || question.trim().length === 0) {
          send(response, 400, { error: "a question string is required" });
          return;
        }
        send(response, 200, ask(runtime.state, question));
      })
      .catch((error: unknown) => {
        send(response, 400, { error: error instanceof Error ? error.message : "bad request" });
      });
    return;
  }

  if (request.method === "POST" && path === "/api/commands") {
    void readJson(request)
      .then((body) => {
        const command = parseCommand(body);
        if (!command) {
          send(response, 400, { error: "unrecognised command", accepted: false });
          return;
        }
        send(response, 200, runtime.execute(command));
      })
      .catch((error: unknown) => {
        send(response, 400, { error: error instanceof Error ? error.message : "bad request" });
      });
    return;
  }

  send(response, 405, { error: "method not allowed" });
});

const sockets = new WebSocketServer({ server, path: "/ws" });

/**
 * How far behind a client may fall before it stops being sent frames.
 *
 * A frame is roughly 25 KB, so this is about forty of them — two seconds of
 * wall clock at the fastest speed. Past that the client is not slow, it is
 * stuck, and queueing more only grows the server's memory on its behalf.
 */
const MAX_SOCKET_BACKLOG_BYTES = 1024 * 1024;

sockets.on("connection", (socket: WebSocket) => {
  // A new client gets a bounded tail of history once, then deltas.
  socket.send(JSON.stringify({ type: "hello", frame: runtime.getFrame(true) }));

  // Skipping a frame is not free: frames carry *deltas*, so a client that
  // misses one has a hole in its event feed for the rest of the run. When a
  // client falls behind we therefore remember to re-send it a full frame once
  // it recovers, rather than quietly leaving it with a gap it cannot detect.
  let needsResync = false;

  const unsubscribe = runtime.subscribe((frame) => {
    if (socket.readyState !== socket.OPEN) return;

    if (socket.bufferedAmount > MAX_SOCKET_BACKLOG_BYTES) {
      needsResync = true;
      return;
    }

    if (needsResync) {
      needsResync = false;
      socket.send(JSON.stringify({ type: "hello", frame: runtime.getFrame(true) }));
      return;
    }

    socket.send(JSON.stringify({ type: "frame", frame }));
  });

  // An unhandled 'error' on a Node EventEmitter is thrown, and a throw here
  // reaches the runtime's publish loop. That is survivable now, but the socket
  // is the right place to deal with a socket's own failure.
  socket.on("error", (error: Error) => {
    console.error("[sunucu] soket hatası:", error.message);
    unsubscribe();
  });

  socket.on("message", (raw) => {
    // Socket traffic is treated exactly like REST input: parsed, validated,
    // and rejected when it is not a known command.
    try {
      const command = parseCommand(JSON.parse(String(raw)));
      if (!command) {
        socket.send(JSON.stringify({ type: "error", message: "unrecognised command" }));
        return;
      }
      socket.send(JSON.stringify({ type: "commandResult", result: runtime.execute(command) }));
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "invalid message" }));
    }
  });

  socket.on("close", unsubscribe);
});

server.listen(PORT, () => {
  console.log(`${BRAND.full} — motor http://localhost:${PORT} adresinde`);
  console.log(`  REST      GET  /api/health /api/config /api/frame /api/snapshot /api/events`);
  console.log(`            GET  /api/products/:id /api/analytics /api/copilot/suggestions`);
  console.log(`            GET  /api/report/excel /api/report/pdf`);
  console.log(`            POST /api/commands /api/copilot`);
  console.log(`  WebSocket ws://localhost:${PORT}/ws`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    runtime.dispose();
    sockets.close();
    server.close(() => process.exit(0));
  });
}
