# API Reference

All routes return JSON. Protected routes use the HTTP-only `sentinel_session` cookie. Errors use an `error` message and machine-readable `code`.

## Authentication

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Authenticate and create a session |
| `POST` | `/api/auth/logout` | Revoke the session |
| `GET` | `/api/auth/me` | Return the current session and user |
| `POST` | `/api/auth/forgot` | Start password reset |
| `POST` | `/api/auth/reset` | Confirm password reset |
| `POST` | `/api/auth/verify/send` | Send an email verification code |
| `POST` | `/api/auth/verify/confirm` | Confirm email verification |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/users` | List, create, update, or delete users; platform admin only |

## Operations

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/console` | Complete console bootstrap snapshot |
| `GET` | `/api/console?live=1` | Uncached live snapshot; blocked while halted |
| `GET` | `/api/cases` | Review cases |
| `POST` | `/api/cases/[id]/actions` | Hold, investigate, escalate, or dismiss a case |
| `GET`, `POST` | `/api/cases/[id]/comments` | Read or add analyst notes |
| `GET`, `POST` | `/api/policy` | Read or promote policy artifacts |
| `GET`, `POST` | `/api/graph` | Read or rebuild the linked-risk graph snapshot |
| `GET`, `POST` | `/api/merchants/overrides` | Read or apply merchant-specific review rules |

## Simulator and agents

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/simulator` | Save and evaluate a simulator run |
| `POST` | `/api/simulator/interventions` | Apply a simulator intervention |
| `POST` | `/api/simulator/approvals/[id]` | Approve or decline an agent decision |
| `POST` | `/api/simulator/agent-chat` | Message a selected specialist agent |

## Sentinel

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/sentinel` | Ask Sentinel using conversation history and live context |
| `POST` | `/api/copilot` | Backward-compatible alias for `/api/sentinel` |

Most operational writes call the shared halt guard and return HTTP `423` with code `OPERATIONS_HALTED` while the site is halted. Sentinel is intentionally exempt.

## Request conventions

- Send JSON with `Content-Type: application/json` for all POST, PATCH, and DELETE routes.
- Authentication is cookie-based in the browser. The Next.js API manages the cookie even when Django is the identity backend.
- Resource authorization is evaluated after authentication and before mutation.
- Merchant-scoped authorization uses the business ID from the target case or override, not a client-provided permission claim.
- Successful mutation responses return the changed record or a refreshed console snapshot, depending on the workflow.

## Common errors

| Status | Typical code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_INPUT` | Required or valid request data is missing |
| `401` | `UNAUTHENTICATED` | Session is missing, expired, revoked, or invalid |
| `403` | `FORBIDDEN` | The role lacks the required capability |
| `403` | `OUT_OF_SCOPE` | A merchant-risk analyst targeted an unassigned business |
| `404` | Resource-specific | Case, user, agent, or approval does not exist |
| `409` | Request-specific | Verification/reset request is used, expired, or conflicts |
| `423` | `OPERATIONS_HALTED` | The request is valid but globally frozen |
| `500` | `INTERNAL_ERROR` | An unexpected server error occurred |

## Representative payloads

### Login

```json
{
  "username": "platform_admin",
  "password": "development-password"
}
```

The response includes `sessionId`, `expiresAt`, and the safe user profile. The raw token is stored in the HTTP-only cookie and is not returned by the Next.js route.

### Delete user

```json
{
  "userId": "usr_example"
}
```

Only Platform Admins can delete accounts. The current account and the final Platform Admin are protected. Successful deletion also removes the account's active sessions, email-verification requests, and password-reset requests.

### Case action

```json
{
  "action": "investigate",
  "note": "Review the linked device cluster before settlement."
}
```

Valid actions are `hold`, `investigate`, `escalate`, and `dismiss`.

### Business override

```json
{
  "merchantId": "M_VYRA",
  "merchantName": "Vyra Travels",
  "strategy": "strict"
}
```

Valid strategies are `strict`, `balanced`, and `lenient`.

### Simulator run

```json
{
  "threshold": 68,
  "autoHoldThreshold": 84,
  "stepUpVerification": true,
  "velocityClamp": true,
  "analystCapacity": 40,
  "replayCohort": "linked_attacks"
}
```

Valid cohorts are `linked_attacks`, `merchant_spike`, `chargeback_ring`, and `weekend_burst`.

### Approval resolution

```json
{
  "status": "approved",
  "note": "Approved for the simulated 30-minute business-lane hold."
}
```

Only `approved` and `rejected` are accepted.

### Selected-agent message

```json
{
  "agentId": "agent_policy_guard",
  "message": "Why did you agree with this hold?",
  "tick": 6,
  "history": [
    { "role": "user", "content": "Summarize your current check." },
    { "role": "assistant", "content": "I am comparing the payment with the current hold threshold." }
  ]
}
```

Messages are limited to 1,500 characters. The endpoint uses at most ten prior conversation messages and caps the generated answer.

### Sentinel message

```json
{
  "history": [
    { "role": "user", "content": "What is happening right now across the console?" }
  ]
}
```

Sentinel uses the latest cross-screen context and remains callable while halted.

## Endpoint authorization summary

Read endpoints generally require any valid authenticated session. Case actions and comments require alert-review permission and merchant scope. Business overrides require override-management permission and merchant scope. Simulator runs, interventions, graph rebuilds, and approval resolution require the relevant simulator or policy capability. User administration requires platform administrator access.
