# Data and Simulation

## Sources

`src/data/baseline-risk-data.ts` contains maintained baseline merchants and transactions used to guarantee meaningful startup states. `src/lib/synthetic-ingestion.ts` adds a rolling stream of generated records.

The generator publishes four completed payments per ten-second batch, retains 48 generated batches, combines them with baseline records, sorts by event time, and limits the working transaction set to 360 records. Generated situations include ordinary purchases, flash sales, travel surges, subscription retries, card testing, account takeover, refund abuse, mule networks, wallet takeover, friendly fraud, bot checkout, and location anomalies.

Generation is deterministic for each time batch. Users see new data over time without unstable random output during a single render.

## Risk scoring

`src/lib/risk-engine.ts` evaluates transaction signals such as amount, retries, device age, geographic distance, IP velocity, night traffic, previous chargebacks, and status. It derives transaction scores, severity, explanations, recommendations, merchant health, alerts, and dashboard metrics.

The LLM layer does not calculate or override these scores.

## Linked-risk graph

`src/lib/server/graph-intelligence.ts` groups related risky records into graph nodes and clusters. The simulator uses the same operational snapshot so labels, payments, businesses, and queue state stay aligned across screens.

## Simulation

`src/lib/simulation-engine.ts` replays scenarios against policy inputs including review threshold, automatic-hold threshold, extra verification, velocity controls, analyst capacity, and replay cohort. Outputs include precision, recall, false-positive rate, caught value, review load, frames, agent actions, and approval requests.

Saved runs, interventions, policy artifacts, merchant overrides, cases, notes, telemetry, memory, and decisions persist through the operational store.

## Data limitations

- All merchants, customers, payments, and outcomes are synthetic.
- The console does not ingest external webhooks or execute payment actions.
- Metrics demonstrate system behavior; they are not production model validation.
- Deleting local operational storage resets accumulated local state.

## Payment scoring rules

The deterministic score sums applicable trigger weights, payment-status weight, and a chargeback-rate adjustment, then caps the result at 98.

| Evidence | Condition | Weight |
| --- | --- | --- |
| Unusually large payment | Amount at least INR 70,000 | 20 |
| New device | Device age at most one day | 18 |
| Location shift | At least 1,000 km from the usual area | 16 |
| Retry cluster | At least three attempts | 14 |
| IP velocity | At least seven payments from one internet address | 14 |
| Unusual hour | Night-traffic flag | 8 |
| Chargeback history | At least two previous chargebacks | 16 |
| Business failures | Merchant failure rate at least 8% | 10 |
| Incomplete business checks | Provisional KYC tier | 10 |

Failed payments add 10, pending payments add 7, and refunded payments add 6. A business chargeback rate above 1% adds a scaled adjustment.

Display severity is critical at 85+, high at 68-84, and medium below 68. The alert population uses 68 as its baseline review threshold.

## Business health

Business health starts with trust and is reduced by chargeback rate, failure rate, and the number of flagged payments. A shorter settlement delay can provide a small positive offset. The result has a floor of 24 and drives monitor, review, watch, or escalate status. Businesses are sorted from lowest health to highest so the most pressured profiles appear first.

## Replay policy defaults

| Control | Default | Allowed range or behavior |
| --- | --- | --- |
| Review threshold | 68 | 55-85 |
| Automatic-hold threshold | 84 | At least review threshold, at most 96 |
| Extra verification | Enabled | Boolean |
| Velocity clamp | Enabled | Boolean |
| Analyst capacity | 40 | 32-80 concurrent reviews |
| Replay cohort | Linked attacks | Four supported cohorts |

## Evaluation language

- **Precision / correct risk decisions:** likely-fraud payments in the reviewed population divided by all reviewed payments.
- **Recall / fraud found:** likely-fraud payments caught divided by all likely-fraud payments in the replay.
- **False-positive rate:** challenged legitimate payments relative to the reviewed population.
- **False-positive cost:** an estimate combining 2.8% of legitimate held value and INR 380 per challenged legitimate payment.
- **Loss avoided:** held likely-fraud value plus 62% of likely-fraud value routed through extra verification.
- **Queue delta:** reviewed payment count minus analyst capacity.

These values compare policies inside the demonstration. They are not financial forecasts.

## Model role

The replay model produces fraud probability, confidence, top feature drivers, and a model summary. Deterministic policy still classifies observe, extra verification, or hold outcomes. The model assists evaluation and explanation; it is not an unrestricted autonomous decision maker.

## Retention behavior

The operations service retains bounded histories for high-churn artifacts: up to 12 policy artifacts, 12 simulator runs, and 10 graph snapshots in active storage paths. Sentinel receives recent bounded slices of cases, comments, memories, actions, and audit events to keep prompts useful and controlled.
