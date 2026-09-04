# Setup and Operations

## Prerequisites

- Node.js 20 or newer
- npm
- Docker Desktop for the optional backend stack
- Python 3.14 only when running Django outside Docker

## Standalone mode

```powershell
npm install
Copy-Item .env.example .env.local
```

Clear `DJANGO_AUTH_API_BASE_URL`, `SENTINEL_DATABASE_URL`, and `SENTINEL_REDIS_URL` in `.env.local` to use local fallbacks, then run `npm run dev`.

The local stores are created under `.runtime/`. This directory is ignored by version control.

## Full backend mode

Keep the service connection values from `.env.example`, then run:

```powershell
docker compose up --build
npm run dev
```

The compose stack runs Django on port `8000`, PostgreSQL on port `5432`, and Redis on port `6379`. The Django container runs migrations and seeds development users during startup.

Stop services with `docker compose down`. Use `docker compose down -v` only when you intentionally want to delete PostgreSQL and Redis volumes.

## Validation

```powershell
npm run lint
npx tsc --noEmit
npm run build
python backend/manage.py check
```

If Python dependencies are not installed locally, run `docker compose run --rm sentinel-backend python manage.py check`.

## Troubleshooting

- **Authentication backend unavailable:** start Docker or clear `DJANGO_AUTH_API_BASE_URL` to use local auth.
- **Model responses use fallback text:** verify the selected component's provider, model, and component-specific API key.
- **Operational endpoint returns 423:** the site is halted; select Continue in the Control Room.
- **Hydration warning contains `fdprocessedid`:** a browser extension modified form controls before React loaded. Disable that extension for localhost or test in an extension-free profile.
- **Stale local state:** stop the app and remove the relevant file under `.runtime/`. This resets local data and sessions.

## Startup sequence

In full backend mode, Compose starts PostgreSQL and Redis before Django. The Django entrypoint runs migrations, seeds development users, and starts the server on port 8000. Next.js remains a separate local process and connects through the values in `.env.local`.

In standalone mode, Next.js creates local auth and operations stores on first use. No database migration command is required.

## Local state files

| File | Contents | Safe reset effect |
| --- | --- | --- |
| `.runtime/auth-store.json` | Local users, hashed passwords, sessions, verification and reset requests | Recreates seeded local users and invalidates sessions |
| `.runtime/ops-store.json` | Cases, comments, audit, policies, graph, runs, overrides, memories, approvals, telemetry | Recreates baseline operational state |
| `.runtime/django.sqlite3` | Django development database when PostgreSQL is not configured | Requires migrations and reseeding |
| `.runtime/tsconfig.tsbuildinfo` | TypeScript incremental compiler cache | Rebuilt automatically |

Stop running processes before deleting a mutable store. Do not delete `.runtime/` merely to clear a visual browser issue.

## Service health checks

```powershell
docker compose ps
docker compose logs sentinel-backend
docker compose exec sentinel-postgres pg_isready -U sentinel
docker compose exec sentinel-redis redis-cli ping
```

Django should report no system issues with `python backend/manage.py check`. The Next.js production build is the strongest repository-wide compile check because it validates route discovery, server/client boundaries, TypeScript, and static generation.

## Suggested development loop

1. Start the selected infrastructure mode.
2. Run `npm run dev`.
3. Validate the affected workflow in Continue state.
4. Repeat it in Halt state when the change touches timers, writes, agents, or APIs.
5. Check a merchant-scoped user when the change targets businesses or cases.
6. Run lint, strict TypeScript, Knip, Django checks, and a production build before handoff.

## Data reset and Docker volumes

`docker compose down` preserves database and Redis volumes. `docker compose down -v` destroys them. The latter is appropriate only for an intentional full backend reset. It does not remove Next.js local files under `.runtime/`.
