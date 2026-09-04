# Project Story

## The problem Sentinel addresses

A payment-risk team rarely suffers from a lack of signals. It suffers from fragmented understanding. One tool reports payment velocity, another contains merchant history, another manages review queues, and a separate model dashboard reports precision and recall. By the time a person has assembled the context, a risky payment may have settled or a legitimate business may have been disrupted unnecessarily.

Sentinel brings that work into one operating surface. It is designed around a simple idea: machines can collect evidence, calculate risk, and coordinate recommendations quickly, but a person should retain control over consequential decisions.

The project demonstrates this idea without pretending to be connected to a real payment processor. It creates a changing synthetic payment environment, applies deterministic rules and a replay model, gives four specialist agents the same operational context, and records human decisions. The result behaves like a live risk console while remaining reproducible and safe to run locally.

## A payment's journey

Consider a high-value UPI payment submitted to a travel business. The payment comes from a device first seen today, originates far from the customer's usual area, follows several rapid retries, and belongs to a customer connected to earlier chargebacks.

### 1. Ingestion creates the event

The synthetic ingestion service publishes completed batches every ten seconds. Each generated payment has a stable ID, business, customer, amount, method, status, timestamp, device age, geographic distance, retry count, IP velocity, night-traffic flag, and previous-chargeback count.

Generation is deterministic inside each time bucket. A server render and browser hydration therefore see the same record for that bucket, while later refreshes introduce new situations.

### 2. Deterministic scoring explains the risk

The risk engine evaluates explicit rules. In this example, the large amount, fresh device, geographic shift, retries, velocity, and chargeback history each add weight. Payment status and the business's chargeback rate may add more. The score is capped at 98.

A score of 68 or more enters the review population. A score of 85 or more is critical in the main risk view. The system stores the triggered rules, a plain-language explanation, and a defensive recommendation with the scored payment.

This stage does not call an LLM. The same inputs produce the same score and recommendation.

### 3. The console aligns every view

The payment appears in Payments with its complete record and in Alerts when it crosses the review threshold. Its business profile updates with flagged-payment count, captured volume, health score, dominant risk, and review status. Graph intelligence connects the payment to its business, customer, shared signals, and queue pressure. Overview aggregates the event into exposure, method, trend, and workload metrics.

All of these views are adapters over the same current snapshot. Sentinel does not invent separate facts for each page.

### 4. A review case is created

The operations service reconciles scored alerts with persisted cases. If the transaction has no case, it creates one. If a case already exists, its score, reason, recommendation, severity, exposure, and cluster reference are refreshed without discarding its human workflow state.

An analyst can investigate, hold, escalate, or dismiss the case and can add notes. Every mutation is authenticated, checked against the user's capability and merchant scope, persisted, and represented in the audit history.

### 5. The simulator asks a different question

The live risk score asks, "How suspicious is this payment?" The simulator asks, "What happens to the whole operation if we use this policy?"

It replays cohorts such as linked attacks, merchant spikes, chargeback rings, or weekend bursts. The administrator can vary the review threshold, automatic-hold threshold, extra verification, velocity controls, analyst capacity, and merchant-specific rules. The simulator measures likely fraud found, correctness of risk decisions, legitimate payments challenged, estimated false-positive cost, review load, and estimated loss avoided.

### 6. Four agents examine the same situation

Signal Scout describes the shared payment and device pattern. Merchant Guard checks whether the activity is abnormal for the business. Policy Guard compares the proposed response with configured thresholds and the cost of a mistake. Queue Ops checks whether reviewers can absorb the work and how urgent items should be routed.

Their baseline actions are deterministic. When component-specific API keys are configured, an LLM can rewrite explanatory reasoning into more natural operational language. It cannot change the underlying score, policy result, authorization decision, or recorded action.

The Control Room turns these actions into a chronological group discussion. Previous and current messages stay visible. The Terminal provides a direct conversation with the selected agent, while Monitor shows the team discussion.

### 7. Consensus becomes a human decision

When all four specialist actions for a simulator event point to the same decision, Sentinel creates a pending approval request. The Decisions tab presents the target, proposed action, rationale, agreement, supporting evidence, and expected effect in plain language.

An authorized platform administrator or risk lead can approve or reject it. The resolution records the actor, timestamp, status, and note. Approval is therefore an explicit domain event, not a button that silently changes presentation state.

### 8. Halt freezes the operation

Halt is a site-wide operating state, not a page-local animation control. It persists in local storage and a cookie. While halted, live refreshes, case mutations, simulator changes, agent chat, policy evaluation, graph rebuilds, and ordinary model calls stop. Protected APIs return HTTP 423 rather than continuing in the background.

Sentinel chat remains available deliberately. An administrator can ask what is happening, inspect the frozen snapshot, and understand what will resume before selecting Continue.

## What the project proves

Sentinel demonstrates that a risk console can combine deterministic evidence, simulation, multi-agent explanation, and human governance without allowing generated text to become the source of truth. It also demonstrates graceful degradation: the core application remains usable without external model providers, PostgreSQL, Redis, or Django.

## What the project does not claim

- It does not process or settle real payments.
- It does not consume external payment webhooks.
- It does not validate a production fraud model.
- It does not execute holds against a payment gateway.
- Its monetary outcomes are simulation estimates, not audited savings.
