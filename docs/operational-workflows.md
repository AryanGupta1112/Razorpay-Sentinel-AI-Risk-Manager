# Operational Workflows

## Live snapshot refresh

1. A protected page requires a valid session.
2. The server reads the global operating-mode cookie.
3. `getConsoleBootstrap` loads generated risk data and persisted operational state.
4. The operations service reconciles current alerts into review cases.
5. The simulator, graph, policy, agent runtime, and UI adapters are assembled.
6. The browser renders one consistent snapshot across the selected screen.
7. While Continue is active and the document is visible, the browser requests `/api/console?live=1` every ten seconds.
8. The live endpoint bypasses the short console cache and skips expensive agent-reasoning enrichment.
9. While Halt is active, the refresh loop does not run and the live endpoint returns HTTP 423 if called directly.

## Alert review

1. A scored payment at or above 68 becomes an alert candidate.
2. The operations service creates or refreshes its review case.
3. The analyst opens the alert and reads raw context, triggers, explanation, recommendation, and notes.
4. The server verifies `review_alerts` and, where applicable, merchant scope.
5. The analyst chooses investigate, hold, escalate, or dismiss.
6. The case status and audit event are persisted.
7. Relevant caches are invalidated and the refreshed snapshot appears across the console.

Case notes follow the same authorization and halt rules. Reading notes is permitted while halted; adding notes is not.

## Business-specific rule change

1. An authorized user opens a business detail modal.
2. The user chooses strict, balanced, or lenient review behavior.
3. The server checks `manage_merchant_overrides` and merchant scope.
4. Strict stores threshold offsets of -4 review and -3 automatic hold; lenient stores +3 and +2; balanced stores zero offsets.
5. The override is persisted and included in subsequent simulation classification.
6. Console and Sentinel context caches are invalidated.

An override changes policy treatment in the demonstration. It does not modify the business's source data or call an external system.

## Policy simulation

1. The user selects a replay cohort and policy controls.
2. Inputs are clamped to supported ranges: review threshold 55-85, automatic hold at least the review threshold and at most 96, analyst capacity 32-80.
3. The simulator mutates the selected cohort, builds model insights, clusters related signals, classifies outcomes, and creates frames.
4. It measures precision, recall, false-positive rate, legitimate value held, review load, and estimated loss avoided.
5. Four specialist agents receive the same events, policy, model summary, cluster data, and queue state.
6. The run, policy artifact, memories, approvals, telemetry, and audit event are persisted.
7. The UI refreshes with the new graph, discussion, metrics, and decisions.

## Agent deliberation and decision

1. Each specialist emits an action for a simulator event from its own operational perspective.
2. The console adapter orders these actions into readable messages and preserves prior discussions.
3. When the four actions agree, the operations store creates one consensus approval request with evidence and rationale.
4. The Decisions tab displays pending and resolved requests.
5. A user with simulator-edit permission submits approved or rejected status and an optional note.
6. The server records resolver, time, note, and an audit event.

Agent conversation is explanatory. The approval request is the persistent business record.

## Direct agent conversation

1. The administrator selects an agent in the Control Room.
2. Terminal sends the agent ID, message, active simulator step, and recent conversation history.
3. The endpoint adds only relevant live context: current situation, that agent's work, team discussion, and pending decisions.
4. The selected agent's configured provider answers in under 90 words when available.
5. If the provider fails or has no key, a deterministic response based on the current agent action is returned.

Direct agent chat is blocked during Operations Halt because agents are considered stopped. Sentinel chat remains available because it is the system guide rather than a working specialist.

## Halt and Continue

1. Selecting Halt writes `halted` to browser local storage and the `sentinel_operations_mode` cookie.
2. All pages observe the same state, including immersive views.
3. Client timers, live refresh, and simulation progression stop.
4. Server mutation guards reject blocked requests with HTTP 423 and `OPERATIONS_HALTED`.
5. The shared LLM client refuses ordinary completions while halted.
6. Reloading or navigating preserves the state from storage and cookie.
7. Selecting Continue writes `running`, dispatches the shared mode-change event, and permits work to resume.

## Authentication and session restoration

1. The login route sends username and password to Django when configured, otherwise to the local auth store.
2. Non-admin users are rejected until email verification when that policy is enabled.
3. A successful login issues a random session token and stores it in an HTTP-only cookie.
4. Protected pages resolve the session before loading console data.
5. Logout revokes the server-side session where supported and expires the cookie.
6. Password or access changes revoke existing sessions for the affected user.

## Failure and fallback behavior

- Missing LLM key: structured local explanations continue.
- LLM timeout or provider error: the request returns local fallback text.
- Missing Redis: cache falls back to the process memory map.
- Missing PostgreSQL: operational state falls back to `.runtime/ops-store.json`.
- Missing Django URL: authentication falls back to `.runtime/auth-store.json`.
- Configured but unreachable Django URL: authentication reports backend unavailable rather than silently switching identity stores.
- Halted operation: the last complete snapshot stays visible and mutations are rejected.
