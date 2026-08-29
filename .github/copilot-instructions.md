# Copilot Instructions for This Repo

## Big Picture
- This is a deterministic automotive smart-factory digital twin.
- The TypeScript engine in `src/` is the source of truth; the web app never invents state.
- Live operation is split into two processes: `npm run server` on port `4000`, and `cd web && npm run dev` on port `3000`.
- The server exposes REST for snapshots/commands and WebSocket `/ws` for one frame per tick.

## Architecture Rules
- Keep simulation logic in `src/engine.ts`; its tick order is part of the contract: scenario events → machine health → materials → release → intralogistics → station advance → logistics → schedule review → metrics.
- `src/runtime.ts` owns wall-clock timing, commands, frame sequencing, and subscriptions; it must not decide factory behavior.
- `src/analytics.ts` and `src/copilot.ts` are deterministic, evidence-based analysis only; the copilot routes intent, it does not compute or guess.
- The command centre is a thin client. `web/src/lib/contract.ts` is type-only re-exports from the engine/domain layer, and `web/src/lib/api.ts` talks to the host over HTTP.

## UI/Data Flow Conventions
- `web/src/lib/use-factory.ts` owns socket subscription, frame coalescing, stale detection, and reconnect logic.
- `web/src/components/command-center.tsx` is the shell that joins config + live frame + user commands; panels below it should read from the same frame.
- The 3D scene and schematic use `web/src/lib/scene-layout.ts`; positions come from factory config/location data, not scene-side guesses.
- Use `NEXT_PUBLIC_TWIN_API` only for the public localhost host URL; no secrets are read in the browser.

## Project Workflows
- Root checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.
- Engine scenario runs: `npm run scenario -- <scenario>`, `npm run scenario -- --compare --ticks=300`, `npm run scenario -- machine_failure --json --ticks=200`.
- Web checks: `cd web && npm run test`, `cd web && npm run typecheck`, `cd web && npm run lint`, `npm run web:build` from the repo root.
- If you change client/server contracts, verify both sides: root tests plus web tests or typecheck as relevant.

## Coding Patterns
- Prefer explicit, typed domain objects in `src/domain.ts` and keep runtime state mutations inside the engine/state layer.
- Preserve determinism: all randomness flows through the seeded RNG and scenario events, not ad hoc `Math.random()` calls.
- Commands should be validated before execution; invalid bodies are rejected rather than coerced.
- UI labels, status colors, and scene placement should come from shared lookup tables (`web/src/lib/status.ts`, `web/src/lib/scene-layout.ts`) instead of duplicated logic.

## Key References
- Engine and tick flow: `src/engine.ts`, `src/runtime.ts`, `src/state.ts`
- Analysis/copilot: `src/analytics.ts`, `src/copilot.ts`
- Host/API: `src/server.ts`
- Web app shell: `web/src/components/command-center.tsx`, `web/src/lib/use-factory.ts`, `web/src/lib/api.ts`
- Scene mapping: `web/src/lib/scene-layout.ts`

## When Editing
- Do not add a second source of truth in the UI.
- Keep changes minimal and consistent with the existing deterministic model.
- Update or add tests when you change engine behavior, API contracts, or scene/layout logic.