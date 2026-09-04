# Domain Glossary

This glossary defines the language used across the product, API, and code. Product copy should prefer the plain-language term; implementation names may retain established compatibility terms where noted.

| Term | Meaning |
| --- | --- |
| Payment | A synthetic transaction evaluated by Sentinel. The code type is `Transaction`. |
| Risk payment | A payment enriched with score, severity, triggers, explanation, and recommendation. The code type is `RiskTransaction`. |
| Business | The merchant receiving payments. Product UI says Business; data and API types use Merchant for payment-industry precision. |
| Risk trigger | A named, weighted condition that contributes to a payment score. |
| Risk score | A deterministic value from 0 to 98 representing accumulated warning evidence. It is not an LLM confidence score. |
| Severity | The display category derived from risk score: medium, high, or critical. |
| Alert | A scored payment at or above the review threshold that requires attention. |
| Review case | The persistent operational record used to investigate and resolve an alert. |
| Case action | A human workflow transition: investigate, hold, escalate, or dismiss. |
| Hold | A defensive recommendation or case state indicating that payout or processing should be paused. In this project it is simulated and does not reach a payment gateway. |
| Operations Halt | The global application state that freezes live and mutating operational work. It is distinct from holding one payment. |
| Continue | The global state that permits live refresh, simulation, agent work, and operational mutations. |
| Business health score | A derived indicator combining trust, chargebacks, failures, flagged payments, and settlement delay. Lower values require more attention. |
| Business override | A strict, balanced, or lenient adjustment applied to review and automatic-hold thresholds for one business. |
| Linked-risk cluster | A group of businesses, payments, customers, and shared signals that form a connected suspicious pattern. |
| Replay cohort | The scenario family used by a simulator run: linked attacks, merchant spike, chargeback ring, or weekend burst. |
| Policy | The thresholds, verification controls, velocity control, analyst capacity, and business overrides used to classify replayed payments. |
| Policy artifact | A persisted evaluation of a policy, including precision, recall, false-positive cost, review load, calibration, and recommendation. |
| Simulator run | A persisted replay of one cohort under one policy configuration. |
| Intervention | An administrator-initiated change to a simulator target, policy, replay cohort, or business rule. |
| Agent action | One specialist's recommendation for a target at a simulator step. |
| Deliberation | The ordered discussion assembled from the four agents' actions for one situation. |
| Consensus | Agreement by the specialist team on one recommended action. |
| Decision | The human-facing proposal produced from consensus. |
| Approval request | The persistent record that awaits an authorized person's approval or rejection. |
| Agent memory | A compact persisted summary of an agent's earlier action and reasoning. It is not unrestricted long-term model memory. |
| Agent telemetry | Per-agent operational counts, confidence, queue effect, and estimated loss prevented. |
| Sentinel | The always-available assistant that can explain product behavior and current cross-screen state. |
| Specialist agent | Signal Scout, Merchant Guard, Policy Guard, or Queue Ops. Each has a narrow operational responsibility. |
| Local fallback | Deterministic application behavior used when an LLM key, database, cache, or auth service is unavailable or intentionally not configured. |
| Synthetic ingestion | Time-batched generation of realistic demonstration records. It is not an external integration. |

## Important distinctions

- A **payment hold** affects one case recommendation; **Operations Halt** freezes the whole application workflow.
- A **risk score** comes from deterministic rules; **agent confidence** describes one simulated agent action.
- An **alert** is current risk evidence; a **review case** preserves human workflow and notes over time.
- A **business override** adjusts one business; a **policy** controls the replay as a whole.
- An **agent decision** is a recommendation; an **approval** is the authorized human resolution.
