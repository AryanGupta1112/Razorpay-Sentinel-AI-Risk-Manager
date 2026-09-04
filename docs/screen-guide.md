# Screen Guide

## Landing and authentication

The landing page introduces Sentinel's shared-risk view and routes authenticated users into the console. Login accepts provisioned accounts only; there is no public registration. Verify Email and Forgot Password are secondary authentication flows backed by short-lived numeric codes.

After login, the server restores the session from an HTTP-only cookie and loads the user's role, merchant scope, and capabilities before rendering protected screens.

## Main navigation

The compact left rail expands while hovered to reveal labels and collapses when the pointer leaves. Route access is filtered by the current user's capabilities. Standard pages retain the rail; Control Room and Simulator use immersive layouts and provide a route back to the previous standard page.

## Overview

Overview is the operational briefing. It combines aggregate exposure, payment and business risk, review demand, trend data, payment-method breakdown, current cases, policy quality, and shortcuts into deeper workspaces.

Use it to answer:

- How much suspicious value is visible?
- Which businesses need attention first?
- Is the review queue within capacity?
- Is the current policy catching likely fraud without challenging too many safe payments?

## Sentinel

Sentinel is a conversational guide with broad project and live-state context. It receives current overview metrics, alerts, businesses, recent payments, graph clusters, policy, cases, comments, business rules, simulator state, pending approvals, agent performance, memory, and audit history.

It uses everyday language and distinguishes facts from recommendations. It remains enabled during Operations Halt. If its configured provider is unavailable, deterministic local answers still explain the current snapshot.

## Alerts

Alerts is the case-review workbench. It supports status filtering, pagination, expanded explanations, analyst ownership, current status, recommendations, case actions, and persisted notes.

Available actions are Hold, Investigate, Send Up, and Clear. They update a persistent review case rather than mutating the generated payment. Merchant-scoped users can only act on businesses inside their scope.

## Businesses

Businesses ranks merchant profiles by operational risk. Each record exposes category, business ID, volume, region, owner, risk score, chargeback rate, fraud rate, and alert count. Selecting a record opens a detailed modal with the complete business profile and business-specific review controls.

Strict rules lower thresholds for more review, balanced rules restore the baseline, and lenient rules raise thresholds to reduce unnecessary review. Overrides require permission and are disabled while halted.

## Payments

Payments shows the rolling transaction stream with pagination and search/filter context. Selecting a record opens a detailed modal containing identifiers, business context, amount, method, status, timing, device and location evidence, retries, prior chargebacks, score, severity, triggers, explanation, and recommendation.

The detail view is the best place to separate raw payment facts from derived risk interpretation.

## Simulator

Simulator is an interactive map of businesses, customers, payments, shared patterns, verification controls, and queue pressure. Nodes and edges reflect the same data used by the risk engine and graph service. Selecting a node opens stable details and actions without losing selection during live updates.

The replay has no artificial final step. It can continue cycling through scenario frames while operations continue. Controls let authorized users change replay cohorts and apply interventions. Metrics show policy effects on loss avoided, correctness, fraud found, safe-payment cost, and analyst load.

## Control Room

The Control Room focuses on the four illustrated specialists working around one shared table. Its compact command panel contains global Continue/Halt controls and six workspaces:

- **Terminal** is a direct conversation with the selected agent while that agent works.
- **Monitor** is a continuous, chronological group conversation across all four agents.
- **Ask Me** provides contextual prompts and explanations.
- **Triggers** shows automation and scheduling activity.
- **Activity** displays an append-only operational message feed.
- **Decisions** lists team recommendations awaiting or recording human resolution.

The Monitor retains prior messages instead of replacing the conversation with only the latest frame. Decisions explain the evidence, agreement, operational effect, and review consequences before approval or rejection.

## Admin

Admin is available only to platform administrators. It lists users and supports creating, updating, and permanently deleting accounts while managing username, email, role, password, and business scope. New accounts always start unverified and operators complete verification using the code sent to their email. Changes to password or access revoke existing sessions; deletion removes every session and recovery request associated with the account. The signed-in account and final Platform Admin cannot be deleted.

## Responsive behavior

Headers reflow before account controls can clip. Dense merchant data becomes labeled record cards on constrained screens instead of compressing table columns. Alert filters and actions wrap, and immersive Control Room panels stack when horizontal space is insufficient.
