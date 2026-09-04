# Configuration

Copy `.env.example` to `.env.local`. Keep real keys only in `.env.local`; all `.env*` files are ignored except the committed example.

## Sentinel assistant

| Variable | Purpose |
| --- | --- |
| `SENTINEL_LLM_PROVIDER` | `groq`, `gemini`, `openrouter`, or `local` |
| `SENTINEL_LLM_MODEL` | Provider model identifier |
| `SENTINEL_API_KEY` | API key used only by Sentinel chat |

## Specialist agents

Each agent has an independent `PROVIDER`, `MODEL`, and `API_KEY` triplet:

- `AGENT_SIGNAL_SCOUT_*`
- `AGENT_MERCHANT_GUARD_*`
- `AGENT_POLICY_GUARD_*`
- `AGENT_QUEUE_COORDINATOR_*`

Put each key in that component's `*_API_KEY` variable. There is no shared provider-key fallback. This keeps quotas and credentials isolated and makes Queue Ops suitable for a second OpenRouter key.

`OPENROUTER_SITE_URL` and `OPENROUTER_APP_NAME` identify this application in OpenRouter request headers; they are not credentials.

## Service connections

| Variable | Purpose | Empty behavior |
| --- | --- | --- |
| `DJANGO_AUTH_API_BASE_URL` | Django API base, normally `http://127.0.0.1:8000/api` | Uses local JSON auth |
| `SENTINEL_DATABASE_URL` | PostgreSQL URL for operational state | Uses `.runtime/ops-store.json` |
| `SENTINEL_DATABASE_POOL_MAX` | Maximum connections per Next.js process | `10` |
| `SENTINEL_DATABASE_IDLE_MS` | Time before an unused connection closes | `30000` |
| `SENTINEL_DATABASE_CONNECT_MS` | Maximum time allowed to establish a connection | `5000` |
| `SENTINEL_REDIS_URL` | Redis URL for snapshots and assistant context | Uses in-process cache |

## Local Docker database

The Compose stack reads PostgreSQL settings from environment variables. Docker Compose loads a root `.env` file automatically; that file is ignored by Git.

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_DB` | `sentinel` | Local database name |
| `POSTGRES_USER` | `sentinel` | Local database user |
| `POSTGRES_PASSWORD` | Required | Local database password |

Copy `.env.example` to `.env` before using Docker Compose and replace `change_me_before_running_docker`. If Next.js also connects directly to PostgreSQL, keep `.env.local` or the shell `SENTINEL_DATABASE_URL` value in sync.

If an existing Docker volume was created with older credentials, either set `POSTGRES_PASSWORD` to that old local value or recreate the local volume with `docker compose down -v`.

## Authentication and email

| Variable | Purpose |
| --- | --- |
| `DJANGO_SECRET_KEY` | Django signing secret; replace outside development |
| `DJANGO_AUTH_TOKEN_TTL_HOURS` | Session lifetime |
| `DJANGO_AUTH_CODE_TTL_MINUTES` | Verification and reset code lifetime |
| `AUTH_REQUIRE_VERIFICATION_FOR_NON_ADMINS` | Requires verification for every non-superuser account |
| `AUTH_EXPOSE_CODES` | Includes development codes in API responses when explicitly enabled |
| `DJANGO_EMAIL_HOST` | SMTP host, normally `smtp.gmail.com` |
| `DJANGO_EMAIL_PORT` | SMTP port, normally `587` |
| `DJANGO_EMAIL_USE_TLS` | Enables SMTP STARTTLS |
| `DJANGO_EMAIL_HOST_USER` | SMTP username |
| `DJANGO_EMAIL_HOST_PASSWORD` | SMTP password or application password |
| `DJANGO_EMAIL_FROM` | Sender address |
| `DJANGO_EMAIL_TIMEOUT_SECONDS` | SMTP connection timeout; defaults to `10` seconds |
When SMTP credentials are empty, Django uses its console email backend and prints messages in the backend logs. With credentials configured, verification and password-reset messages are sent through SMTP.

For a local Django process, `DATABASE_URL` selects PostgreSQL, `DJANGO_SQLITE_PATH` overrides the SQLite file, and `SENTINEL_RUNTIME_DIR` overrides the default `.runtime/` location.

## Default model assignments

| Component | Default provider | Default model | Credential variable |
| --- | --- | --- | --- |
| Sentinel | Groq | `openai/gpt-oss-20b` | `SENTINEL_API_KEY` |
| Signal Scout | Gemini | `gemini-3.5-flash-lite` | `AGENT_SIGNAL_SCOUT_API_KEY` |
| Merchant Guard | Groq | `openai/gpt-oss-20b` | `AGENT_MERCHANT_GUARD_API_KEY` |
| Policy Guard | OpenRouter | `openrouter/auto` | `AGENT_POLICY_GUARD_API_KEY` |
| Queue Ops | OpenRouter | `openrouter/auto` | `AGENT_QUEUE_COORDINATOR_API_KEY` |

The provider is considered live only when that component has a non-empty key and its provider is not `local`. Changing one component does not alter another component's provider or quota.

## Provider behavior

Groq and OpenRouter use OpenAI-compatible chat completions. Gemini uses its native content-generation endpoint. All provider requests have a 15-second timeout. Errors are converted into local fallback results rather than exposing provider response bodies to the browser.

Set a component provider to `local` when deterministic operation is desired even if a key is present.

## Halt behavior

The LLM client checks the server-visible operations cookie before each ordinary completion. Specialist reasoning and direct agent chat therefore stop during Halt. Sentinel explicitly opts into read-only completion during Halt because it is used to explain the frozen system.

## Precedence and isolation

Next.js reads `.env.local` and `.env` according to framework conventions. The Django settings module loads repository `.env.local` and `backend/.env` only for variables not already supplied by the process. Compose-provided values therefore take precedence inside containers.

Never duplicate one real key across the example file, documentation, and runtime files. `.env.example` describes names and safe defaults only.

## Local safety checklist

- Change seeded credentials if the development machine is shared.
- Keep `AUTH_EXPOSE_CODES=false`.
- Keep the service ports on a trusted local interface.
- Configure SMTP with an application password.
- Rotate every provider key that has appeared in logs, screenshots, or shared messages.
- Do not expose server keys through `NEXT_PUBLIC_*` variables.
