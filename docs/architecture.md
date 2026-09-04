# Architecture

## System shape

Sentinel uses a Next.js 16 application for the web console and operational API. Authentication can run through the built-in JSON store or the local Django service. PostgreSQL and Redis provide the complete local stack; JSON and in-memory fallbacks keep lightweight development self-contained.

```text
Browser
  -> Next.js App Router pages and route handlers
      -> risk engine and synthetic ingestion
      -> operations service and simulator
      -> graph intelligence
      -> provider-specific LLM client
      -> PostgreSQL or .runtime/ops-store.json
      -> Redis or in-process cache
      -> Django auth API or .runtime/auth-store.json
```

## Frontend

- Routes live under `src/app/`.
- The standard console shell is composed by `src/components/console-page.tsx` and `src/components/console-app.tsx`.
- The immersive control room is implemented in `src/components/sentinel-control-room-screen.tsx`.
- Authentication views are under `src/components/auth/`.
- Shared domain contracts are under `src/types/`.

The `/sentinel` route is canonical. `/copilot` and `/api/copilot` remain compatibility aliases for older links and clients.

## Domain services

- `src/lib/risk-engine.ts` scores payments and aggregates business risk.
- `src/lib/synthetic-ingestion.ts` produces completed payment batches every ten seconds.
- `src/lib/simulation-engine.ts` builds replay frames, agent work, measurable outcomes, and policy recommendations.
- `src/lib/server/ops-service.ts` coordinates snapshots, cases, comments, decisions, graph data, policy artifacts, and cache invalidation.
- `src/lib/server/graph-intelligence.ts` builds linked-risk clusters.
- `src/lib/sentinel-assistant.ts` answers project and live-state questions in plain language.
- `src/lib/agent-llm.ts` configures the four specialist agents.
- `src/lib/llm.ts` isolates Groq, Gemini, OpenRouter, and local fallback behavior.

## Persistence

Operational state uses PostgreSQL when `SENTINEL_DATABASE_URL` is set. Otherwise it uses `.runtime/ops-store.json`. Authentication uses Django when `DJANGO_AUTH_API_BASE_URL` is set; otherwise it uses `.runtime/auth-store.json`. Django itself uses PostgreSQL when `DATABASE_URL` is set and `.runtime/django.sqlite3` otherwise. Redis is used when `SENTINEL_REDIS_URL` is set, with an in-process cache fallback.

Local JSON writes are serialized by the store modules. Operational mutations invalidate relevant console and assistant cache keys.

## Halt model

The current operating mode is stored in browser local storage and a site cookie. Server route handlers read the cookie and return HTTP `423` for blocked operational work while halted. Live refresh, simulator mutation, case changes, agent progression, and ordinary LLM completions stop. Sentinel chat is the deliberate exception and remains available with `allowDuringHalt` so an administrator can inspect the frozen state.

## Security boundaries

- The HTTP-only `sentinel_session` cookie carries the session token.
- Route handlers authenticate requests before reading protected data.
- Capability checks are enforced server-side; client checks only control presentation.
- Merchant-risk analysts can be restricted to explicit merchant IDs.
- LLM output changes explanatory text, not deterministic risk scores or authorization decisions.
- API keys are read only on the server and must never use a `NEXT_PUBLIC_` prefix.

## Request lifecycle

Protected pages are dynamic server routes. `ConsolePage` resolves the session, reads the operating-mode cookie, requests a console bootstrap, and passes the initial user, mode, and snapshot into the client shell. This avoids rendering an unauthenticated console and gives hydration a deterministic initial state.

After hydration, navigation uses stable route paths and browser history without rebuilding unrelated screen state. The live-refresh loop requests a new bootstrap every ten seconds only while the page is visible and operations are continuing.

## Console bootstrap composition

`getConsoleBootstrap` is the main application composition boundary:

1. Build the current dashboard snapshot from baseline and generated data.
2. Load operational state from PostgreSQL or the JSON fallback.
3. Build the active simulation from the latest saved configuration and business overrides.
4. Optionally enrich deterministic agent reasoning through configured model providers.
5. Reconcile newly scored alerts with persisted review cases.
6. Refresh agent memories, approvals, and telemetry while retaining resolved approvals.
7. Select or create the current policy artifact, graph snapshot, and simulator run.
8. Adapt the domain records into the `ConsoleData` shape consumed by the UI.
9. Cache the result for 20 seconds unless the caller requests a live bypass.

## Storage adapters

The operations store exposes one logical `OpsStore` whether it is backed by JSON or PostgreSQL. PostgreSQL tables use the `sentinel_ops_` prefix and cover cases, comments, audit events, policy artifacts, graph snapshots, simulator runs, business overrides, memories, approvals, and telemetry.

The JSON adapter preserves the same shape in `.runtime/ops-store.json`. This makes fallback behavior visible and testable instead of implementing a separate reduced product.

Authentication follows the same adapter principle. Next.js owns the browser cookie and route-level checks. It either delegates identity operations to Django or uses the local auth store with equivalent roles, sessions, verification requests, and reset requests.

## Cache behavior

Redis is optional. When configured, JSON snapshots are stored with short time-to-live values. Without Redis, the cache module uses process memory. Console and Sentinel context entries expire after 20 seconds. Operational mutations invalidate both relevant key families so user actions do not remain hidden behind stale snapshots.

## LLM boundaries

The shared completion layer supports Groq and OpenRouter through OpenAI-compatible chat-completion requests and Gemini through `generateContent`. Calls use a 15-second timeout and return a typed local result on missing keys, Halt, provider errors, or empty output.

Each component supplies its own API key. There is intentionally no global provider credential fallback. Sentinel passes `allowDuringHalt: true`; specialist agents do not.

## Repository map

```text
backend/                         Django authentication service
docs/                            authoritative project documentation
public/sentinel-control-room/    shipped office illustration and pixel font
src/app/                         pages and JSON route handlers
src/components/                  console, auth, landing, and motion UI
src/data/                        maintained baseline risk records
src/lib/                         domain and provider services
src/lib/server/                  authenticated storage and orchestration
src/types/                       shared domain contracts
.runtime/                        ignored local state and compiler cache
compose.yaml                     Django, PostgreSQL, and Redis services
```

## Deliberate compatibility surfaces

The product name is Sentinel, and `/sentinel` is the canonical assistant route. `/copilot` and `/api/copilot` remain as compatibility aliases because removing externally reachable paths is a breaking change. Internal implementation uses `sentinel-assistant.ts`.
