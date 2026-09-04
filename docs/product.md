# Product

## Purpose

Sentinel helps payment-risk teams understand suspicious activity, coordinate specialist review, test defensive policy, and retain human control over consequential actions. It is a risk-operations product, not an autonomous payment processor or an offensive-security tool.

## Main workspaces

- **Overview** summarizes risk exposure, review demand, detection quality, and recent activity.
- **Sentinel** answers questions about the product and current operational state in everyday language.
- **Control Room** shows four agents discussing active situations and submitting one team decision for approval or rejection.
- **Simulator** maps businesses, customers, payments, patterns, queues, and controls while replaying changing scenarios.
- **Alerts** provides explainable case review, actions, notes, and status filters.
- **Businesses** provides merchant health, risk metrics, alerts, details, and business-specific review rules.
- **Payments** provides the current transaction stream and detailed payment records.
- **Admin** allows platform administrators to provision users and manage access.

## Specialist agents

- **Signal Scout** finds unusual payment, device, velocity, and location patterns.
- **Merchant Guard** compares activity with the affected business's normal behavior.
- **Policy Guard** checks recommendations against rules and false-positive cost.
- **Queue Ops** considers analyst capacity, urgency, and routing.

Agents may use separate model providers and API keys. They discuss evidence and form a team recommendation, but an authorized human approves or declines decisions that require sign-off.

## Operating states

Continue allows live ingestion, simulation, agent activity, operational API mutations, and configured model calls. Halt freezes those systems across pages and persists across reloads until a user selects Continue. Sentinel chat remains available during Halt so users can ask what stopped and inspect the current snapshot.

## Data statement

The project is not connected to an external payment network. It combines maintained baseline records with deterministic, time-batched synthetic ingestion. Data varies continuously and represents realistic demonstrations, not actual customers or payments.

## Product constraints

- Defensive actions only
- Human approval for consequential team decisions
- Plain-language explanations alongside risk terminology
- Deterministic scoring remains authoritative over generated narratives
- No claim of external payment execution or production fraud prevention

## Users and responsibilities

**Platform administrators** operate the environment, control Halt and Continue, manage users, inspect every business, and resolve team decisions.

**Risk leads** evaluate thresholds, model performance, simulator outcomes, business overrides, and approval requests. They own the balance between fraud capture and customer impact.

**Fraud operations analysts** investigate alerts, update cases, and record evidence. Their primary concern is making timely, explainable case decisions.

**Merchant risk analysts** examine business behavior and can tune review rules for businesses inside their assigned scope. They cannot alter global policy or user administration.

## Product principles

1. **Structured evidence before generated prose.** Scores, triggers, cases, metrics, and permissions are computed before an LLM is invited to explain them.
2. **One operational truth.** Screens adapt the same snapshot instead of maintaining contradictory page-local datasets.
3. **Human control at consequential boundaries.** Agent consensus produces a proposal, not silent execution.
4. **Graceful local operation.** A missing optional service changes the adapter, not the core product journey.
5. **Explain customer impact.** Policy quality includes false positives, review capacity, and legitimate value affected, not only fraud caught.
6. **Preserve operator context.** Open records, selected simulator nodes, Control Room conversations, and global operating state should survive routine refreshes.

## Demonstration narrative

1. Start on Overview and identify the highest-pressure business and queue condition.
2. Open Payments to inspect the raw payment facts and risk triggers.
3. Open Alerts to review the persistent case, recommendation, and analyst notes.
4. Open Businesses to compare the payment with merchant health and, if authorized, test a business-specific rule.
5. Open Simulator to replay a coordinated scenario under the current policy.
6. Watch the four agents exchange evidence in Control Room Monitor.
7. Open Decisions to review the unanimous recommendation and approve or reject it.
8. Select Halt and verify that live activity freezes across every screen while Sentinel remains able to explain the frozen state.

## Definition of a successful experience

- A non-technical reviewer can explain why a payment was flagged.
- A risk lead can describe the tradeoff between recall, precision, false-positive cost, and queue capacity.
- A human can identify exactly which recommendations are pending and who resolved earlier decisions.
- The app remains coherent with or without external LLM and infrastructure services.
- No screen implies that synthetic businesses or payments are real.
