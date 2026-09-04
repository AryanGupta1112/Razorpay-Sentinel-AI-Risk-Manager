# Authentication and Access Control

## Authentication modes

When `DJANGO_AUTH_API_BASE_URL` is configured, Next.js proxies authentication and user administration to Django. Otherwise the same application flows use `.runtime/auth-store.json`. Both modes issue an HTTP-only `sentinel_session` cookie.

Supported flows are login, logout, session restore, email verification, password reset, and full user administration. Password changes and access changes revoke existing sessions.

## Roles

| Capability | Platform Admin | Risk Lead | Fraud Ops Analyst | Merchant Risk Analyst |
| --- | --- | --- | --- | --- |
| Review alerts | Yes | Yes | Yes | Yes, within scope |
| Manage merchant overrides | Yes | Yes | No | Yes, within scope |
| Use Sentinel assistant | Yes | Yes | Yes | No |
| Access Control Room | Yes | Yes | Yes, read-only | No |
| Access simulator | Yes | Yes | Yes, read-only | No |
| Change simulator policy | Yes | Yes | No | No |
| Promote policy | Yes | Yes | No | No |
| Administer users | Yes | No | No | No |
| Halt or continue all operations | Yes | No | No | No |

Server-side checks are authoritative. A Django superuser is always treated as a platform administrator. Merchant scope IDs are normalized and enforced for merchant-risk analysts.

## Development accounts

The Django startup command `seed_sentinel_users` creates four local demonstration accounts:

| Username | Password | Role |
| --- | --- | --- |
| `platform_admin` | `SentinelAdmin!2026` | Platform Admin |
| `risk_lead` | `RiskLead!2026` | Risk Lead |
| `fraud_ops` | `FraudOps!2026` | Fraud Ops Analyst |
| `merchant_risk` | `MerchantRisk!2026` | Merchant Risk Analyst |

These credentials are development-only and must be replaced before any shared or deployed environment. Non-admin accounts require email verification by default.

## Security notes

- Set `AUTH_COOKIE_SECURE=true` behind HTTPS.
- Use a strong `DJANGO_SECRET_KEY` outside local development.
- Keep `AUTH_EXPOSE_CODES=false` outside local development.
- Configure SMTP before relying on verification or reset delivery.
- Never commit `.env.local`, `.runtime/`, database files, or API keys.

## Session model

Sessions use random tokens with a seven-day default lifetime. The browser stores the token in an HTTP-only, same-site cookie. The local auth store persists only a hash of the token. Django stores session-token records with created, updated, expiry, and revocation timestamps.

Protected pages resolve the session on the server before rendering. Protected API routes return `UNAUTHENTICATED` instead of redirecting. Logout revokes the current backend session where supported and expires the browser cookie.

## Email verification

Every account created from the Admin workspace starts unverified, including accounts assigned the Platform Admin role. A verification request belongs to one user, contains a six-digit code, expires after the configured duration, and can only be used once. Only the original recovery superuser bypasses verification. Production always enforces this rule; the environment switch can relax it only during local development. Development responses expose codes only when configured to do so.

## Password reset

Password reset requires an existing account with a verified email. A successful reset marks the request used, updates the password hash, and revokes all active sessions for that user. Passwords must contain at least eight characters; Django additionally applies its configured password validators.

## Merchant scope

Merchant-risk analysts receive only records belonging to their normalized business IDs. The server filters the initial page payload, live console refreshes, cases, and business overrides, and it checks scope again before every action. An empty scope means no business access, never global access. Global clusters, model statistics, agent conversations, and simulator state are not serialized to this role.

## Capability enforcement

The UI receives convenience booleans such as `canReviewAlerts` and `canEditSimulator` to hide or disable unavailable controls. These are not the security boundary. Protected pages reject forbidden screens, read routes enforce view capabilities, mutation routes enforce action capabilities, and merchant resources are checked against explicit scope.

Access or password changes revoke existing user sessions. This prevents a previously issued session from retaining permissions after an administrator changes the account.

## Account deletion

Platform Admins can permanently delete another operator from the Admin workspace. Deletion removes the user and all associated sessions, email-verification requests, and password-reset requests. The server rejects attempts to delete the account used by the current session or the final Platform Admin account, preventing accidental lockout.
