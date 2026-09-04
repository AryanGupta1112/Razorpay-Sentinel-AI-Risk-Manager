# Sentinel Risk Operations Console

**Razorpay Buildathon submission | Track 02: AI Risk Manager**

Sentinel is a defense-only payment-risk operations workspace. It continuously creates a realistic synthetic payment environment, scores suspicious activity with explainable rules, connects related behavior into graph clusters, coordinates four specialist agents, and keeps a human administrator in control of consequential decisions.

The project is designed to feel like a live operating system without claiming a connection to a real payment processor. Its risk decisions are deterministic and reproducible. LLM providers improve the language used by Sentinel and the specialist agents, but they do not calculate risk scores, grant permissions, or silently execute payment actions.

> **Data notice:** every business, customer, payment, alert, and monetary result in this project is synthetic. Holds and interventions are simulated defensive actions.

## Contents

- [Razorpay Buildathon](#razorpay-buildathon)
- [What Sentinel does](#what-sentinel-does)
- [Product tour](#product-tour)
- [How the system works](#how-the-system-works)
- [Technology](#technology)
- [Quick start](#quick-start)
- [Run with Django, PostgreSQL, and Redis](#run-with-django-postgresql-and-redis)
- [Development accounts](#development-accounts)
- [Configure model providers](#configure-model-providers)
- [Environment reference](#environment-reference)
- [Halt and Continue](#halt-and-continue)
- [Project structure](#project-structure)
- [API overview](#api-overview)
- [Validation](#validation)
- [Local state and reset](#local-state-and-reset)
- [Troubleshooting](#troubleshooting)
- [Security and limitations](#security-and-limitations)
- [Documentation](#documentation)

## Razorpay Buildathon

Sentinel was created for the **Razorpay Buildathon** under **Track 02: AI Risk Manager**.

### Track challenge

> Stop the merchant losing money to fraud, returns, and chargebacks.

The track asks builders to create a working detector, verifier, or automatic responder for one class of loss and measure precision and recall on a held-out test set. Suggested directions include chargeback evidence response, return-risk scoring, fraud-spike detection, and abuse-ring detection.

### Sentinel's approach

Sentinel combines fraud-spike detection and linked abuse-ring analysis with a human-controlled response workflow:

- Incoming synthetic payments are evaluated for device, location, retry, velocity, business, identity, and chargeback signals.
- Related payments, customers, businesses, and warning signs are connected in a risk graph so coordinated behavior is visible.
- Four specialist agents independently review high-risk situations, discuss the evidence, and form a unanimous recommendation.
- Consequential decisions remain pending until an authorized operator approves or rejects them.
- The simulator compares defensive policies using precision, recall, false-positive cost, estimated loss avoided, and analyst capacity.

The included datasets and outcomes are synthetic, so the metrics demonstrate the evaluation workflow rather than claiming production performance on Razorpay data.

## What Sentinel does

Payment-risk teams often need to combine transaction evidence, business history, queue pressure, policy performance, and human review before acting. Sentinel keeps those perspectives aligned in one console.

Core capabilities include:

- A continuously changing stream of synthetic businesses, customers, payments, and risk situations
- Deterministic payment scoring with visible triggers and plain-language explanations
- Paginated Alerts, Businesses, and Payments workspaces with complete record details
- Persistent review cases, analyst notes, statuses, and audit history
- Linked-risk graph intelligence across businesses, payments, customers, signals, and queues
- Replayable policy simulation with precision, recall, false-positive cost, loss avoided, and analyst load
- Business-specific strict, balanced, and lenient review rules
- A four-agent Control Room with continuous discussion and retained message history
- Human approval or rejection of unanimous team decisions
- Direct conversations with a selected specialist agent while it works
- An always-available Sentinel assistant with project-wide and live operational context
- Site-wide persistent Halt and Continue controls
- Role-based access control and optional business-level scope
- Local JSON fallbacks plus optional Django, PostgreSQL, and Redis adapters

## Product tour

| Workspace | Purpose |
| --- | --- |
| **Overview** | Summarizes exposure, review workload, businesses under pressure, detection quality, and current activity. |
| **Sentinel** | Explains the product and current cross-screen state in everyday language. It remains available while operations are halted. |
| **Control Room** | Shows Signal Scout, Merchant Guard, Policy Guard, and Queue Ops discussing situations and presenting team decisions. |
| **Simulator** | Maps connected risk entities and replays changing situations under configurable defensive policy. |
| **Alerts** | Supports case review, explanations, actions, notes, status filters, and pagination. |
| **Businesses** | Ranks merchant health, opens detailed profiles, and manages business-specific review rules. |
| **Payments** | Shows the rolling transaction stream and complete payment, device, location, retry, and risk details. |
| **Admin** | Lets platform administrators create, update, and delete users while managing roles, passwords, and business scope. Every newly provisioned account must verify its email. |

### The specialist team

- **Signal Scout** finds unusual payment, device, retry, velocity, and location patterns.
- **Merchant Guard** compares activity with the affected business's expected behavior.
- **Policy Guard** evaluates thresholds, safety rules, and the cost of false positives.
- **Queue Ops** considers analyst capacity, urgency, and review routing.

Each specialist can use an independent provider, model, and API key. Their structured work exists without an LLM; configured models make their explanations more natural and situation-aware.

## How the system works

```text
Baseline records + time-batched synthetic ingestion
                         |
                         v
              Deterministic risk engine
              scores + triggers + severity
                         |
           +-------------+-------------+
           |             |             |
           v             v             v
     Review cases   Business health   Risk graph
           |             |             |
           +-------------+-------------+
                         |
                         v
                 Policy simulator
        precision / recall / cost / capacity
                         |
                         v
            Four specialist agent actions
                         |
                         v
             Team discussion and consensus
                         |
                         v
                Human approve or reject
                         |
                         v
               Persistence + audit history
```

1. `src/data/baseline-risk-data.ts` guarantees meaningful startup records.
2. `src/lib/synthetic-ingestion.ts` publishes four completed payments every ten seconds and retains a rolling generated history.
3. `src/lib/risk-engine.ts` evaluates explicit signals such as amount, device age, geographic shift, retries, IP velocity, unusual hours, chargeback history, business failures, and incomplete identity checks.
4. Payments at or above the review threshold become alerts. The operations service creates or refreshes persistent review cases without discarding human workflow state.
5. Business health, overview metrics, and linked-risk graph clusters are derived from the same current snapshot.
6. `src/lib/simulation-engine.ts` replays linked attacks, merchant spikes, chargeback rings, or weekend bursts under configurable policy.
7. Four specialist agents examine the same event from different operational perspectives. Consensus creates a pending decision, not an automatic external action.
8. An authorized person approves or rejects the decision. The resolver, time, note, and outcome enter the audit history.

Read the complete narrative in [docs/project-story.md](docs/project-story.md) and detailed flows in [docs/operational-workflows.md](docs/operational-workflows.md).

## Technology

### Web application

- Next.js 16 App Router
- React 19
- TypeScript with strict checking
- Tailwind CSS 4
- Motion for interface transitions
- Recharts for operational visualization
- Lucide icons

### Services and persistence

- Next.js route handlers for the console API
- Django 6.1 and Django REST Framework for optional authentication
- PostgreSQL 17 for optional operational and identity persistence
- Redis 8 for optional snapshot and assistant-context caching
- Local JSON and in-process fallbacks for infrastructure-free development

### Model providers

- Groq
- Gemini
- OpenRouter
- Deterministic local fallback

## Quick start

This mode requires no database, Docker service, or model API key.

### Requirements

- Node.js 20 or newer
- npm

### Start the application

```powershell
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

With no service variables configured, Sentinel automatically uses:

- `.runtime/auth-store.json` for users and sessions
- `.runtime/ops-store.json` for cases, policies, graph snapshots, simulator runs, decisions, and audit records
- In-process memory for short-lived cache entries
- Deterministic local text when no component-specific model key exists

Use the platform administrator account from [Development accounts](#development-accounts) to sign in immediately.

## Run with Django, PostgreSQL, and Redis

Use this mode to run the production-shaped backend adapters while keeping Next.js as the web and operational API process.

### Requirements

- Docker Desktop with Docker Compose
- Node.js 20 or newer
- npm

### 1. Create local configuration

```powershell
Copy-Item .env.example .env.local
```

The committed example already points Next.js to:

```env
DJANGO_AUTH_API_BASE_URL=http://127.0.0.1:8000/api
POSTGRES_DB=sentinel
POSTGRES_USER=sentinel
POSTGRES_PASSWORD=change_me_before_running_docker
SENTINEL_DATABASE_URL=postgresql://sentinel:change_me_before_running_docker@127.0.0.1:5432/sentinel
SENTINEL_REDIS_URL=redis://127.0.0.1:6379/1
```

For Docker mode, copy `.env.example` to `.env` and replace `change_me_before_running_docker` before starting Compose. Docker Compose reads `.env` automatically; Git ignores it.

Add model keys only if live generated explanations are required.

### 2. Start backend services

```powershell
docker compose up --build -d
docker compose ps
```

Compose starts:

| Service | Address | Role |
| --- | --- | --- |
| `sentinel-backend` | `http://127.0.0.1:8000` | Django authentication and user administration |
| `sentinel-postgres` | `127.0.0.1:5432` | Persistent relational storage |
| `sentinel-redis` | `127.0.0.1:6379` | Runtime cache |

The Django entrypoint runs migrations and seeds development accounts before starting its server.

The committed database values are placeholders, not usable production credentials. Put a real local `POSTGRES_PASSWORD` and matching `SENTINEL_DATABASE_URL` in `.env` or `.env.local` for any shared environment. If an older local Docker volume was created with a different password, set the old value temporarily or recreate the volume with `docker compose down -v`.

### 3. Start Next.js

```powershell
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Stop services

```powershell
docker compose down
```

This preserves PostgreSQL and Redis volumes. To intentionally destroy those volumes:

```powershell
docker compose down -v
```

## Development accounts

Both local authentication and the Django seed command create the same demonstration users.

| Username | Password | Role | Initial state |
| --- | --- | --- | --- |
| `platform_admin` | `SentinelAdmin!2026` | Platform Admin | Verified; can log in immediately |
| `risk_lead` | `RiskLead!2026` | Risk Lead | Email verification required by default |
| `fraud_ops` | `FraudOps!2026` | Fraud Ops Analyst | Email verification required by default |
| `merchant_risk` | `MerchantRisk!2026` | Merchant Risk Analyst | Verification required; scoped to `M_QUICKBASKET` and `M_VYRA` |

These credentials are for local development only. Replace or remove them before any shared or deployed environment.

## Configure model providers

Model integration is optional. Copy `.env.example` to `.env.local`, then place each key only in the component that should use it.

| Component | Default provider | Default model | Key variable |
| --- | --- | --- | --- |
| Sentinel | Groq | `openai/gpt-oss-20b` | `SENTINEL_API_KEY` |
| Signal Scout | Gemini | `gemini-3.5-flash-lite` | `AGENT_SIGNAL_SCOUT_API_KEY` |
| Merchant Guard | Groq | `openai/gpt-oss-20b` | `AGENT_MERCHANT_GUARD_API_KEY` |
| Policy Guard | OpenRouter | `openrouter/auto` | `AGENT_POLICY_GUARD_API_KEY` |
| Queue Ops | OpenRouter | `openrouter/auto` | `AGENT_QUEUE_COORDINATOR_API_KEY` |

Example:

```env
SENTINEL_LLM_PROVIDER=groq
SENTINEL_LLM_MODEL=openai/gpt-oss-20b
SENTINEL_API_KEY=your_sentinel_key

AGENT_QUEUE_COORDINATOR_PROVIDER=openrouter
AGENT_QUEUE_COORDINATOR_MODEL=openrouter/auto
AGENT_QUEUE_COORDINATOR_API_KEY=your_second_openrouter_key
```

There is no shared provider-key fallback. This isolates credentials and quotas between Sentinel and the four agents. Set a component's provider to `local` to force deterministic responses.

OpenRouter also reads:

```env
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=Sentinel AI Risk Console
```

These values identify the application in request headers; they are not credentials.

## Environment reference

### Service connections

| Variable | Purpose | Behavior when empty |
| --- | --- | --- |
| `DJANGO_AUTH_API_BASE_URL` | Django API base URL | Uses local JSON authentication |
| `SENTINEL_DATABASE_URL` | PostgreSQL connection for operational state | Uses `.runtime/ops-store.json` |
| `SENTINEL_DATABASE_POOL_MAX` | PostgreSQL connections per Next.js instance | `1` on Vercel, otherwise `10` |
| `SENTINEL_DATABASE_CONNECT_MS` | PostgreSQL connection timeout in milliseconds | `2500` maximum on Vercel, otherwise `5000` |
| `SENTINEL_REDIS_URL` | Redis connection for snapshots and assistant context | Uses process memory |
| `POSTGRES_DB` | Local Compose database name | Defaults to `sentinel` |
| `POSTGRES_USER` | Local Compose database user | Defaults to `sentinel` |
| `POSTGRES_PASSWORD` | Local Compose database password | Required for Docker Compose |

### Authentication and email

| Variable | Purpose | Default |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | Django signing secret | Development-only value |
| `DJANGO_AUTH_TOKEN_TTL_HOURS` | Session lifetime | `168` |
| `DJANGO_AUTH_CODE_TTL_MINUTES` | Verification and reset-code lifetime | `30` |
| `AUTH_REQUIRE_VERIFICATION_FOR_NON_ADMINS` | Local verification switch; production requires verification for every non-superuser | `true` |
| `AUTH_EXPOSE_CODES` | Include development codes in responses | `false` in the example |
| `DJANGO_EMAIL_HOST_USER` | SMTP username | Empty |
| `DJANGO_EMAIL_HOST_PASSWORD` | SMTP password or application password | Empty |
| `DJANGO_EMAIL_FROM` | Sender address | Empty |
| `RESEND_API_KEY` | Resend HTTPS API key for hosted email delivery | Empty |
| `RESEND_FROM_EMAIL` | Sender identity on a verified Resend domain | Empty |

When SMTP credentials are empty, local Django uses its console email backend. Render free services block SMTP ports, so hosted deployments should configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; Resend then takes precedence over SMTP. See [docs/configuration.md](docs/configuration.md) for provider behavior, precedence, and deployment guidance.

## Halt and Continue

Halt is a global operating state, not a visual pause button. Only a Platform Admin can change it. It is stored in browser local storage and the `sentinel_operations_mode` cookie, so it survives reloads and applies across standard and immersive screens.

While **Halt** is active:

- Live console refresh stops
- Synthetic feed advancement is no longer requested by the browser
- Simulator progression and interventions stop
- Case actions and new notes are rejected
- Policy evaluation and graph rebuilds are rejected
- Specialist-agent chat and ordinary LLM calls stop
- Protected mutation endpoints return HTTP `423` with `OPERATIONS_HALTED`
- The last complete state remains visible

Sentinel chat remains available intentionally so an operator can inspect and understand the frozen state. Selecting **Continue** restores operational work across the site.

## Project structure

```text
.
|-- backend/                         Django authentication service
|   |-- sentinel_auth/               users, sessions, verification, reset, RBAC
|   `-- sentinel_backend/            Django project settings and routing
|-- docs/                            authoritative project documentation
|-- public/sentinel-control-room/    shipped office illustration and pixel font
|-- src/
|   |-- app/                         Next.js pages and route handlers
|   |-- components/                  console, control room, auth, landing, motion
|   |-- data/                        maintained baseline risk records
|   |-- lib/                         scoring, ingestion, simulation, agents, LLMs
|   |   `-- server/                  auth, orchestration, persistence, caching
|   `-- types/                       domain, operations, and authentication types
|-- .runtime/                        ignored local stores and compiler cache
|-- compose.yaml                     Django, PostgreSQL, and Redis stack
|-- .env.example                     safe configuration template
`-- README.md                        project onboarding and operating guide
```

Important modules:

| Module | Responsibility |
| --- | --- |
| `src/lib/synthetic-ingestion.ts` | Builds rolling generated businesses and payments |
| `src/lib/risk-engine.ts` | Calculates payment scores, alerts, and business health |
| `src/lib/simulation-engine.ts` | Replays policy scenarios and calculates outcomes |
| `src/lib/simulator-agents.ts` | Produces structured specialist actions |
| `src/lib/sentinel-assistant.ts` | Builds project-wide and live assistant answers |
| `src/lib/agent-llm.ts` | Resolves per-agent provider, model, and key configuration |
| `src/lib/server/ops-service.ts` | Composes snapshots and coordinates operational mutations |
| `src/lib/server/ops-store.ts` | Implements PostgreSQL and JSON operational persistence |
| `src/lib/server/auth.ts` | Handles sessions, capabilities, Django delegation, and local fallback |
| `src/components/console-app.tsx` | Renders the standard console workspaces |
| `src/components/sentinel-control-room-screen.tsx` | Renders the immersive multi-agent workspace |

## API overview

All protected APIs require the `sentinel_session` HTTP-only cookie. Errors return a readable `error` and machine-readable `code`.

### Authentication

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot`
- `POST /api/auth/reset`
- `POST /api/auth/verify/send`
- `POST /api/auth/verify/confirm`
- `GET|POST|PATCH|DELETE /api/users`

### Operations

- `GET /api/console`
- `GET /api/console?live=1`
- `GET /api/cases`
- `POST /api/cases/[id]/actions`
- `GET|POST /api/cases/[id]/comments`
- `GET|POST /api/merchants/overrides`
- `GET|POST /api/policy`
- `GET|POST /api/graph`

### Simulator and agents

- `POST /api/simulator`
- `POST /api/simulator/interventions`
- `POST /api/simulator/approvals/[id]`
- `POST /api/simulator/agent-chat`
- `POST /api/sentinel`

`POST /api/copilot` remains a backward-compatible alias for Sentinel. Request examples and authorization behavior are documented in [docs/api-reference.md](docs/api-reference.md).

## Validation

Run the complete frontend validation set:

```powershell
npm run lint
npx tsc --noEmit
npx --yes knip
npm run build
```

Run the Django configuration check without writing Python bytecode:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python backend/manage.py check
```

If Python dependencies are not installed locally:

```powershell
docker compose run --rm sentinel-backend python manage.py check
```

Available npm scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Compile and validate the production application |
| `npm run start` | Run the previously built production server |
| `npm run lint` | Run ESLint against `src/` |

## Local state and reset

| File | Contents | Reset behavior |
| --- | --- | --- |
| `.runtime/auth-store.json` | Local users, sessions, verification, and reset requests | Recreates development users and invalidates sessions |
| `.runtime/ops-store.json` | Cases, notes, audit, policies, graph, simulations, rules, memories, and decisions | Recreates baseline operational state |
| `.runtime/django.sqlite3` | Django database when PostgreSQL is not configured | Requires migrations and user reseeding |
| `.runtime/tsconfig.tsbuildinfo` | Incremental TypeScript cache | Rebuilt automatically |

Stop running processes before deleting mutable state.

To reset local Next.js state:

```powershell
Remove-Item .runtime/auth-store.json
Remove-Item .runtime/ops-store.json
```

To reset Docker data, use `docker compose down -v`. This does not remove files under `.runtime/`.

## Troubleshooting

### Authentication backend unavailable

`DJANGO_AUTH_API_BASE_URL` is configured but Django cannot be reached. Start the Compose stack, or clear that variable to use local authentication. Sentinel does not silently switch identity stores when an explicitly configured backend fails.

### Model responses use local fallback

Verify the provider, model, and component-specific API key. A key in another agent's variable is not reused. Also confirm that operations are continuing for specialist-agent calls.

### An API returns HTTP 423

Operations are halted. Open Control Room and select Continue before attempting an operational mutation.

### A non-admin account cannot log in

Email verification is required by default. Use Verify Email and the configured mail delivery path. Development codes are returned only when allowed by environment settings.

### PostgreSQL or Redis is unavailable

Run `docker compose ps`, inspect `docker compose logs sentinel-backend`, and verify ports 5432 and 6379 are not occupied. If the service variables are cleared, Next.js can operate with local fallbacks.

### Hydration warning contains `fdprocessedid`

A browser extension modified form controls before React hydrated the page. Disable the form-processing or password-manager extension for localhost, or test in an extension-free browser profile. The attribute is not generated by this project.

### The UI shows old operational data

Stop the application and reset the relevant `.runtime/` store, or verify that a configured Redis instance is reachable. Do not delete runtime state merely to fix browser layout or cache issues.

## Security and limitations

### Before deployment

- Replace all development credentials and `DJANGO_SECRET_KEY`.
- Set `AUTH_COOKIE_SECURE=true` behind HTTPS.
- Keep `AUTH_EXPOSE_CODES=false`.
- Restrict `DJANGO_ALLOWED_HOSTS`.
- Configure authenticated SMTP.
- Use managed PostgreSQL and Redis with transport security and restricted network access.
- Rotate any model key that has appeared in screenshots, logs, chat, or source control.
- Never expose server credentials through a `NEXT_PUBLIC_*` variable.

### Current limitations

- No external payment processor or webhook source is connected.
- No payment, settlement, or merchant action is executed outside the simulation.
- Generated financial outcomes are demonstration estimates, not audited savings.
- The deterministic and replay models are product simulations, not production fraud-model validation.
- Local JSON stores are intended for development, not concurrent production workloads.
- The Django development server in Compose is not a production WSGI or ASGI deployment.

## Documentation

All authoritative project documentation lives under [`docs/`](docs/README.md).

| Document | Read this for |
| --- | --- |
| [Project story](docs/project-story.md) | The complete narrative from payment ingestion to human decision |
| [Product](docs/product.md) | Users, principles, workspaces, and demonstration flow |
| [Screen guide](docs/screen-guide.md) | What each page shows and how to use it |
| [Operational workflows](docs/operational-workflows.md) | Detailed live refresh, case, policy, agent, approval, and halt flows |
| [Domain glossary](docs/domain-glossary.md) | Canonical business terminology |
| [Architecture](docs/architecture.md) | Runtime composition, persistence, caching, and security boundaries |
| [Setup and operations](docs/setup-and-operations.md) | Installation, service health, state management, and runbooks |
| [Configuration](docs/configuration.md) | Every provider and service environment setting |
| [API reference](docs/api-reference.md) | Routes, payload examples, errors, and authorization |
| [Data and simulation](docs/data-and-simulation.md) | Generation, scoring rules, policy controls, and evaluation metrics |
| [Access control](docs/access-control.md) | Roles, sessions, verification, reset, and business scope |

`AGENTS.md` and `CLAUDE.md` contain development-tool instructions and are not product documentation.
