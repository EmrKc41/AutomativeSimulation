"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { IS_LOCAL_ENGINE, WS_URL } from "@/lib/api";
import { FrameScheduler, browserClock } from "@/lib/frame-scheduler";
import type { FactoryEvent, FactoryFrame } from "@/lib/contract";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

/**
 * One sample of the numbers worth watching over time.
 *
 * Kept client-side because a trend is a property of what the operator has been
 * watching, not of the factory: the server publishes the present, and how far
 * back "recent" reaches is a question about this screen.
 */
export interface KpiSample {
  readonly minute: number;
  readonly oee: number;
  readonly output: number;
  readonly wip: number;
  readonly firstPassYield: number;
}

export interface FactoryStream {
  readonly frame: FactoryFrame | null;
  /** Recent history, oldest first, for the trend lines. */
  readonly history: readonly KpiSample[];
  readonly events: readonly FactoryEvent[];
  readonly connection: ConnectionState;
  /** True when the clock is running but no frame has arrived recently. */
  readonly stale: boolean;
  readonly lastFrameAt: number | null;
  readonly reconnect: () => void;
}

/** How many events the client keeps for the timeline. The server keeps them all. */
const EVENT_BUFFER = 600;
/** Roughly two shifts of samples at one per published tick. */
const HISTORY_LENGTH = 240;
/** A running clock that goes quiet for this long is reported as stale, not live. */
const STALE_AFTER_MS = 4000;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

/**
 * Subscribe to the twin's frame stream.
 *
 * Two things here are deliberate. Frames are coalesced before they reach React,
 * so a 16x run cannot out-pace rendering and a hidden tab updates far less
 * often. And a frame whose sequence is not newer than the one already rendered
 * is dropped, so an out-of-order or duplicated message can never show the
 * operator a state that has been undone.
 */
export function useFactoryStream(): FactoryStream {
  const [frame, setFrame] = useState<FactoryFrame | null>(null);
  const [events, setEvents] = useState<readonly FactoryEvent[]>([]);
  const [history, setHistory] = useState<readonly KpiSample[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const pendingFrame = useRef<FactoryFrame | null>(null);
  const pendingEvents = useRef<FactoryEvent[]>([]);
  const scheduler = useRef<FrameScheduler | null>(null);
  const lastSequence = useRef<{ simulationId: string; sequence: number } | null>(null);

  const flush = useCallback(() => {
    const next = pendingFrame.current;
    if (!next) return;
    pendingFrame.current = null;
    setFrame(next);
    setLastFrameAt(Date.now());
    setHistory((current) => {
      const last = current.at(-1);
      // One sample per plant minute; a paused clock must not flatten the line
      // with repeated points.
      if (last && last.minute === next.simulatedTime) return current;
      const sample: KpiSample = {
        minute: next.simulatedTime,
        oee: next.metrics.oee,
        output: next.metrics.productionOutput,
        wip: next.metrics.wip,
        firstPassYield: next.metrics.firstPassYield,
      };
      return [...current, sample].slice(-HISTORY_LENGTH);
    });
    if (pendingEvents.current.length > 0) {
      const batch = pendingEvents.current;
      pendingEvents.current = [];
      setEvents((current) => [...current, ...batch].slice(-EVENT_BUFFER));
    }
  }, []);

  /**
   * Coalesce bursts into one render.
   *
   * The decision of *how* to coalesce lives in `FrameScheduler`, because the
   * way this used to be written could wedge the whole stream: it armed a
   * `requestAnimationFrame` and nothing else, so a tab that stopped compositing
   * left the handle set forever and every later frame was dropped as "a render
   * is already pending". The socket stayed open and the board stayed
   * confidently wrong. See `frame-scheduler.test.ts`.
   */
  const schedule = useCallback(() => {
    scheduler.current ??= new FrameScheduler(browserClock, flush);
    scheduler.current.schedule();
  }, [flush]);

  /**
   * Coming back to the tab must show the plant as it is now.
   *
   * Without this the operator sees the last frame that happened to be drawn
   * before they looked away, until the next one arrives.
   */
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) scheduler.current?.flushNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const accept = useCallback(
    (incoming: FactoryFrame, replaceHistory: boolean) => {
      const marker = lastSequence.current;
      const sameRun = marker !== null && marker.simulationId === incoming.simulationId;
      if (sameRun && incoming.sequence < marker.sequence) return; // stale frame
      lastSequence.current = {
        simulationId: incoming.simulationId,
        sequence: incoming.sequence,
      };

      if (replaceHistory || !sameRun) {
        // A new simulation identity means a reset: drop the old timeline rather
        // than blending two runs into one feed.
        pendingEvents.current = [];
        setEvents(incoming.events.slice(-EVENT_BUFFER));
        setHistory([]);
      } else if (incoming.events.length > 0) {
        pendingEvents.current.push(...incoming.events);
      }

      pendingFrame.current = incoming;
      schedule();
    },
    [schedule],
  );

  /*
   * Motor tarayıcıda koşuyorsa soket yok: kareler doğrudan geliyor.
   *
   * Yayındaki sürümün sunucusu olmadığı için "bağlantı" diye bir şey de yok;
   * akış her zaman canlı. Aynı `accept` yolundan geçiyor, yani çerçeve
   * birleştirme, olay tamponu ve çizim zamanlaması uzak moddakiyle birebir
   * aynı — iki ayrı veri yolu yazmak, ikisinin sessizce ayrışması demekti.
   */
  useEffect(() => {
    if (!IS_LOCAL_ENGINE) return;
    let disposed = false;

    let cikis = () => {};
    void import("@/lib/local-engine").then((motor) => {
      if (disposed) return;
      accept(motor.localFrame(true), true);
      setConnection("live");
      cikis = motor.localSubscribe((frame) => {
        if (!disposed) accept(frame, false);
      });
    });

    return () => {
      disposed = true;
      cikis();
    };
  }, [accept]);

  useEffect(() => {
    if (IS_LOCAL_ENGINE) return;
    let disposed = false;
    // Whether *this* socket ever reached the engine, which decides how long to
    // wait before the next try. `attempt` only ever grows, so without this a
    // session that survived five blips would sit on the eight-second delay for
    // the rest of the shift — the longest wait, applied to the healthiest link.
    let everOpened = false;
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      if (disposed) return;
      everOpened = true;
      setConnection("live");
    };

    socket.onmessage = (message) => {
      if (disposed) return;
      try {
        const parsed = JSON.parse(String(message.data)) as
          | { type: "hello"; frame: FactoryFrame }
          | { type: "frame"; frame: FactoryFrame }
          | { type: "error"; message: string }
          | { type: "commandResult" };
        if (parsed.type === "hello") accept(parsed.frame, true);
        else if (parsed.type === "frame") accept(parsed.frame, false);
      } catch {
        // A malformed message is dropped; the next frame recovers the view.
      }
    };

    socket.onclose = () => {
      if (disposed) return;
      setConnection("reconnecting");
      const delay = everOpened
        ? RECONNECT_DELAYS_MS[0]
        : (RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 8000);
      window.setTimeout(() => {
        if (!disposed) setAttempt((value) => value + 1);
      }, delay);
    };

    socket.onerror = () => {
      if (!disposed) setConnection("offline");
    };

    return () => {
      disposed = true;
      scheduler.current?.cancel();
      socket.close();
    };
  }, [accept, attempt]);

  // A running clock only needs a heartbeat to notice it has gone quiet; a
  // paused one is not stale, it is simply stopped.
  useEffect(() => {
    if (frame?.status !== "running") return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [frame?.status]);

  // Staleness is about the data, not the socket, so it is derived rather than
  // stored: a connected stream that stopped delivering frames is not "live".
  const stale =
    frame?.status === "running" && lastFrameAt !== null && nowTick - lastFrameAt > STALE_AFTER_MS;

  const reconnect = useCallback(() => {
    socketRef.current?.close();
    setAttempt((value) => value + 1);
  }, []);

  return { frame, events, history, connection, stale, lastFrameAt, reconnect };
}
