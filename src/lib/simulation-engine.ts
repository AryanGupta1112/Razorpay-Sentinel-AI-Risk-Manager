import { getDashboardSnapshot } from "@/lib/risk-engine";
import { money } from "@/lib/format";
import { buildFraudModel } from "@/lib/ml-risk";
import { buildAgentActions } from "@/lib/simulator-agents";
import {
  DefenseAgentAction,
  DefenseLabCluster,
  DefenseLabConfig,
  DefenseLabEdge,
  DefenseLabEvent,
  DefenseLabFrame,
  DefenseLabMetric,
  DefenseLabNode,
  DefenseLabSnapshot,
  DefenseMlInsight,
  ReplayCohort,
  RiskTransaction,
} from "@/types/risk";
import type { MerchantOverrideRecord } from "@/types/ops";

export const DEFAULT_CONFIG: DefenseLabConfig = {
  threshold: 68,
  autoHoldThreshold: 84,
  stepUpVerification: true,
  velocityClamp: true,
  analystCapacity: 40,
};

const DEFAULT_REPLAY_COHORT: ReplayCohort = "linked_attacks";

const SIGNAL_LIBRARY = [
  {
    id: "cluster_device",
    label: "Fresh device burst",
    description: "First-seen device fingerprints are colliding across high-value retries.",
    match: (transaction: RiskTransaction) => transaction.deviceAgeDays <= 1,
  },
  {
    id: "cluster_geo",
    label: "Geo deviation ring",
    description: "The payment route is shifting too far from the customer's recent history.",
    match: (transaction: RiskTransaction) => transaction.geoDistanceKm >= 1000,
  },
  {
    id: "cluster_retry",
    label: "Retry pressure",
    description: "Repeated attempts are stacking faster than clean customer recovery behavior.",
    match: (transaction: RiskTransaction) => transaction.attempts >= 3,
  },
  {
    id: "cluster_history",
    label: "Chargeback-linked customers",
    description: "Known dispute-linked customers are returning through risky traffic paths.",
    match: (transaction: RiskTransaction) => transaction.previousChargebacks >= 2,
  },
];

function mergeConfig(input?: Partial<DefenseLabConfig>): DefenseLabConfig {
  return {
    threshold: Math.min(85, Math.max(55, input?.threshold ?? DEFAULT_CONFIG.threshold)),
    autoHoldThreshold: Math.min(
      96,
      Math.max(input?.threshold ?? DEFAULT_CONFIG.threshold, input?.autoHoldThreshold ?? DEFAULT_CONFIG.autoHoldThreshold),
    ),
    stepUpVerification: input?.stepUpVerification ?? DEFAULT_CONFIG.stepUpVerification,
    velocityClamp: input?.velocityClamp ?? DEFAULT_CONFIG.velocityClamp,
    analystCapacity: Math.min(80, Math.max(32, input?.analystCapacity ?? DEFAULT_CONFIG.analystCapacity)),
  };
}

function isFraudLikely(transaction: RiskTransaction) {
  const signalCount = transaction.triggers.filter((trigger) =>
    ["high_amount", "new_device", "geo_shift", "retry_cluster", "velocity", "history"].includes(
      trigger.code,
    ),
  ).length;

  return (
    transaction.score >= 86 ||
    (signalCount >= 4 && transaction.amount >= 50000) ||
    (transaction.deviceAgeDays <= 1 && transaction.previousChargebacks >= 2) ||
    (transaction.geoDistanceKm >= 1000 && transaction.ipVelocity >= 7 && transaction.attempts >= 3)
  );
}

function applyReplayMutation(
  transaction: RiskTransaction,
  cohort: ReplayCohort,
  index: number,
): RiskTransaction {
  if (cohort === "linked_attacks") {
    return transaction;
  }

  const nextScore =
    cohort === "merchant_spike"
      ? Math.min(98, transaction.score + (transaction.merchantId === "m_quickbasket" || transaction.merchantId === "m_vyra" ? 6 : 2))
      : cohort === "chargeback_ring"
        ? Math.min(98, transaction.score + (transaction.previousChargebacks >= 2 ? 8 : 3))
        : Math.min(98, transaction.score + (transaction.nightTraffic ? 7 : 4));

  const nextAmount =
    cohort === "merchant_spike"
      ? Math.round(transaction.amount * (transaction.merchantId === "m_quickbasket" ? 1.16 : 1.08))
      : cohort === "chargeback_ring"
        ? Math.round(transaction.amount * 1.1)
        : Math.round(transaction.amount * 1.12);

  const nextExplanation =
    cohort === "merchant_spike"
      ? `${transaction.explanation} Merchant-spike cohort amplifies checkout retries and settlement pressure on this merchant lane.`
      : cohort === "chargeback_ring"
        ? `${transaction.explanation} Replay cohort adds prior-dispute traffic concentration around returning customers.`
        : `${transaction.explanation} Weekend burst cohort adds off-hour congestion and higher concurrent review load.`;

  return {
    ...transaction,
    amount: nextAmount,
    score: nextScore,
    severity: nextScore >= 85 ? "critical" : nextScore >= 68 ? "high" : "medium",
    explanation: nextExplanation,
    recommendation:
      nextScore >= 85
        ? "Hold settlement and queue merchant for immediate review."
        : nextScore >= 68
          ? "Step up verification and cap payment velocity for 24 hours."
          : "Monitor pattern drift and sample manually.",
    triggers:
      cohort === "weekend_burst" && !transaction.triggers.some((trigger) => trigger.code === "weekend_burst")
        ? [...transaction.triggers, { code: "weekend_burst", label: "Weekend concurrency burst", weight: 9 + (index % 3) }]
        : transaction.triggers,
  };
}

function buildReplayTransactions(
  transactions: RiskTransaction[],
  cohort: ReplayCohort,
): RiskTransaction[] {
  const cohortSeed =
    cohort === "linked_attacks"
      ? transactions.filter((transaction) => transaction.score >= 58)
      : cohort === "merchant_spike"
        ? transactions.filter((transaction) => ["m_quickbasket", "m_vyra"].includes(transaction.merchantId))
        : cohort === "chargeback_ring"
          ? transactions.filter((transaction) => transaction.previousChargebacks >= 1 || transaction.score >= 72)
          : transactions.filter((transaction) => transaction.nightTraffic || transaction.status !== "captured");

  return cohortSeed
    .slice(0, cohort === "linked_attacks" ? 10 : 12)
    .map((transaction, index) => applyReplayMutation(transaction, cohort, index))
    .sort((left, right) => right.score - left.score);
}

function getMerchantThresholds(
  transaction: RiskTransaction,
  config: DefenseLabConfig,
  overrides: MerchantOverrideRecord[],
) {
  const override = overrides.find((entry) => entry.merchantId === transaction.merchantId);

  if (!override) {
    return {
      threshold: config.threshold,
      autoHoldThreshold: config.autoHoldThreshold,
      strategy: null as MerchantOverrideRecord["strategy"] | null,
    };
  }

  return {
    threshold: Math.max(55, Math.min(90, config.threshold + override.thresholdOffset)),
    autoHoldThreshold: Math.max(
      config.threshold,
      Math.min(96, config.autoHoldThreshold + override.autoHoldOffset),
    ),
    strategy: override.strategy,
  };
}

function classifyOutcome(
  transaction: RiskTransaction,
  config: DefenseLabConfig,
  overrides: MerchantOverrideRecord[],
): DefenseLabEvent["outcome"] {
  const merchantThresholds = getMerchantThresholds(transaction, config, overrides);

  if (transaction.score >= merchantThresholds.autoHoldThreshold) {
    return "hold";
  }

  if (transaction.score >= merchantThresholds.threshold && config.stepUpVerification) {
    return "step-up";
  }

  return "observe";
}

function buildClusters(transactions: RiskTransaction[]): DefenseLabCluster[] {
  return SIGNAL_LIBRARY.map((signal) => {
    const members = transactions.filter(signal.match);

    return {
      id: signal.id,
      label: signal.label,
      description: signal.description,
      transactionIds: members.map((transaction) => transaction.id),
      merchantIds: [...new Set(members.map((transaction) => transaction.merchantId))],
      pressure: members.reduce((total, transaction) => total + transaction.score, 0),
    };
  })
    .filter((cluster) => cluster.transactionIds.length > 0)
    .sort((left, right) => right.pressure - left.pressure)
    .slice(0, 3);
}

function buildNodes(
  transactions: RiskTransaction[],
  clusters: DefenseLabCluster[],
  config: DefenseLabConfig,
  overrides: MerchantOverrideRecord[],
): DefenseLabNode[] {
  const merchants = [...new Map(transactions.map((transaction) => [transaction.merchantId, transaction])).values()];
  const merchantNodes: DefenseLabNode[] = merchants.map((transaction, index) => ({
    id: `merchant_${transaction.merchantId}`,
    label: transaction.merchantName,
    type: "merchant",
    x: 13,
    y: 24 + index * 28,
    risk: transaction.score,
    status: transaction.score >= config.threshold ? "watch" : "stable",
    meta: [
      transaction.method,
      money(transaction.amount),
      getMerchantThresholds(transaction, config, overrides).strategy
        ? `override ${getMerchantThresholds(transaction, config, overrides).strategy}`
        : "baseline policy",
    ],
  }));

  const clusterNodes: DefenseLabNode[] = clusters.map((cluster, index) => ({
    id: cluster.id,
    label: cluster.label,
    type: "cluster",
    x: 42,
    y: 22 + index * 28,
    risk: Math.min(98, Math.round(cluster.pressure / cluster.transactionIds.length)),
    status: "watch",
    meta: [`${cluster.transactionIds.length} linked payments`, `${cluster.merchantIds.length} merchants`],
  }));

  const paymentNodes: DefenseLabNode[] = transactions.map((transaction, index) => {
    const row = index < 3 ? 0 : 1;
    const column = index % 3;

    return {
      id: `payment_${transaction.id}`,
      label: transaction.id,
      type: "payment",
      x: 63 + column * 11.5,
      y: 20 + row * 33,
      risk: transaction.score,
      status: classifyOutcome(transaction, config, overrides) === "hold" ? "blocked" : "watch",
      meta: [
        transaction.merchantName,
        money(transaction.amount),
        `threshold ${getMerchantThresholds(transaction, config, overrides).threshold}`,
      ],
    };
  });

  const customerNodes: DefenseLabNode[] = transactions.slice(0, 2).map((transaction, index) => ({
    id: `customer_${transaction.id}`,
    label: `Customer ${transaction.customer.replace("user_", "#")}`,
    type: "customer",
    x: 83,
    y: 28 + index * 36,
    risk: Math.min(96, transaction.score - 4),
    status: transaction.previousChargebacks >= 2 ? "watch" : "stable",
    meta: [`${transaction.previousChargebacks} prior chargebacks`, `${transaction.ipVelocity} IP velocity`],
  }));

  const verifierNodes: DefenseLabNode[] = [
    {
      id: "verifier_step_up",
      label: "Step-up verifier",
      type: "verifier",
      x: 84,
      y: 72,
      risk: config.stepUpVerification ? 72 : 30,
      status: config.stepUpVerification ? "active" : "stable",
      meta: [config.stepUpVerification ? "OTP + device challenge" : "disabled"],
    },
    {
      id: "queue_manual",
      label: "Manual review queue",
      type: "queue",
      x: 95,
      y: 45,
      risk: config.analystCapacity * 10,
      status: "watch",
      meta: [`Capacity ${config.analystCapacity} analysts`],
    },
  ];

  return [...merchantNodes, ...clusterNodes, ...paymentNodes, ...customerNodes, ...verifierNodes];
}

function buildEdges(
  transactions: RiskTransaction[],
  clusters: DefenseLabCluster[],
  config: DefenseLabConfig,
  overrides: MerchantOverrideRecord[],
): DefenseLabEdge[] {
  const edges: DefenseLabEdge[] = [];

  for (const cluster of clusters) {
    for (const merchantId of cluster.merchantIds) {
      edges.push({
        id: `${merchantId}_${cluster.id}`,
        source: `merchant_${merchantId}`,
        target: cluster.id,
        label: "merchant exposure",
        weight: 1,
        status: "stable",
      });
    }

    for (const transactionId of cluster.transactionIds) {
      edges.push({
        id: `${cluster.id}_${transactionId}`,
        source: cluster.id,
        target: `payment_${transactionId}`,
        label: "signal hit",
        weight: 1.1,
        status: "stable",
      });
    }
  }

  for (const transaction of transactions) {
    const outcome = classifyOutcome(transaction, config, overrides);

    edges.push({
      id: `payment_queue_${transaction.id}`,
      source: `payment_${transaction.id}`,
      target: outcome === "observe" ? "verifier_step_up" : "queue_manual",
      label: outcome === "hold" ? "auto-hold" : outcome === "step-up" ? "challenge" : "monitor",
      weight: outcome === "hold" ? 1.5 : 1,
      status: outcome === "hold" ? "blocked" : outcome === "step-up" ? "active" : "stable",
    });
  }

  for (const transaction of transactions.slice(0, 2)) {
    edges.push({
      id: `payment_customer_${transaction.id}`,
      source: `payment_${transaction.id}`,
      target: `customer_${transaction.id}`,
      label: "identity trace",
      weight: 0.9,
      status: transaction.previousChargebacks >= 2 ? "active" : "stable",
    });
  }

  return edges;
}

function ratio(value: number) {
  return `${Math.round(value * 100)}%`;
}

function buildMetricSet(
  processed: RiskTransaction[],
  allTransactions: RiskTransaction[],
  config: DefenseLabConfig,
  overrides: MerchantOverrideRecord[],
): { cards: DefenseLabMetric[]; evaluation: DefenseLabSnapshot["evaluation"] } {
  const flagged = processed.filter(
    (transaction) => transaction.score >= getMerchantThresholds(transaction, config, overrides).threshold,
  );
  const truePositives = flagged.filter(isFraudLikely);
  const falsePositives = flagged.filter((transaction) => !isFraudLikely(transaction));
  const held = processed.filter((transaction) => classifyOutcome(transaction, config, overrides) === "hold");
  const legitHeldValue = held
    .filter((transaction) => !isFraudLikely(transaction))
    .reduce((total, transaction) => total + transaction.amount, 0);
  const blockedFraudValue = held
    .filter(isFraudLikely)
    .reduce((total, transaction) => total + transaction.amount, 0);
  const stepUpFraudValue = processed
    .filter(
      (transaction) => classifyOutcome(transaction, config, overrides) === "step-up" && isFraudLikely(transaction),
    )
    .reduce((total, transaction) => total + transaction.amount, 0);
  const precision =
    truePositives.length === 0 && falsePositives.length === 0
      ? 1
      : truePositives.length / Math.max(truePositives.length + falsePositives.length, 1);
  const totalFraud = allTransactions.filter(isFraudLikely).length;
  const recall = truePositives.length / Math.max(totalFraud, 1);
  const falsePositiveRate = falsePositives.length / Math.max(flagged.length, 1);
  const falsePositiveCost = legitHeldValue * 0.028 + falsePositives.length * 380;
  const lossAvoided = blockedFraudValue + stepUpFraudValue * 0.62;
  const queueDelta = flagged.length - config.analystCapacity;

  return {
    cards: [
      {
        id: "loss_avoided",
        label: "Loss avoided",
        value: money(Math.round(lossAvoided)),
        delta: `${held.length} payments auto-held`,
        tone: "good",
      },
      {
        id: "precision",
        label: "Correct risk decisions",
        value: ratio(precision),
        delta: `${truePositives.length} true positives`,
        tone: precision >= 0.7 ? "good" : precision >= 0.55 ? "warn" : "bad",
      },
      {
        id: "recall",
        label: "Fraud found",
        value: ratio(recall),
        delta: `${totalFraud} fraud cases in attack set`,
        tone: recall >= 0.7 ? "good" : recall >= 0.55 ? "warn" : "bad",
      },
      {
        id: "false_positive_cost",
        label: "Cost of reviewing safe payments",
        value: money(Math.round(falsePositiveCost)),
        delta: `${falsePositives.length} legitimate payments challenged`,
        tone: falsePositiveCost <= 12000 ? "good" : falsePositiveCost <= 24000 ? "warn" : "bad",
      },
      {
        id: "review_load",
        label: "Analyst load",
        value: `${flagged.length}/${config.analystCapacity}`,
        delta: queueDelta > 0 ? `${queueDelta} above live capacity` : "Within live capacity",
        tone: queueDelta > 1 ? "bad" : queueDelta === 1 ? "warn" : "good",
      },
    ],
    evaluation: {
      reviewedTransactions: flagged.length,
      precision,
      recall,
      falsePositiveRate,
      blockedValue: held.reduce((total, transaction) => total + transaction.amount, 0),
      falsePositiveCost,
      lossAvoided,
    },
  };
}

function buildEvents(
  transactions: RiskTransaction[],
  config: DefenseLabConfig,
  overrides: MerchantOverrideRecord[],
  cohort: ReplayCohort,
  mlInsights: Record<string, DefenseMlInsight>,
): DefenseLabEvent[] {
  return transactions.map((transaction, index) => {
    const outcome = classifyOutcome(transaction, config, overrides);
    const clusterLabels = SIGNAL_LIBRARY.filter((signal) => signal.match(transaction))
      .slice(0, 2)
      .map((signal) => signal.label.toLowerCase());
    const insight = mlInsights[transaction.id];

    return {
      id: `event_${transaction.id}`,
      tick: index + 1,
      transactionId: transaction.id,
      merchantName: transaction.merchantName,
      title:
        outcome === "hold"
          ? `${transaction.merchantName} payment automatically held`
          : outcome === "step-up"
            ? `${transaction.merchantName} needs an extra identity check`
            : `${transaction.merchantName} remains under watch`,
      summary: `${transaction.id} scored ${transaction.score}/100 because of ${clusterLabels.join(" and ") || "unusual business activity"} in this ${cohort.replaceAll("_", " ")} test.`,
      action:
        outcome === "hold"
          ? "The payout was stopped, the payment was sent for urgent review, and repeated attempts were limited."
          : outcome === "step-up"
            ? "The customer must enter a one-time code and confirm the device before trying again."
            : "The payment is not blocked yet. Keep watching and wait for another connected warning sign.",
      amount: money(transaction.amount),
      score: transaction.score,
      outcome,
      probability: insight?.probability ?? transaction.score / 100,
      confidence: insight?.confidence ?? Math.max(0.45, transaction.score / 120),
      topDrivers: insight?.topDrivers ?? [],
      agentActions: [],
    };
  });
}

function buildFrames(
  transactions: RiskTransaction[],
  events: DefenseLabEvent[],
  clusters: DefenseLabCluster[],
  config: DefenseLabConfig,
  overrides: MerchantOverrideRecord[],
  agentActions: DefenseAgentAction[],
): { frames: DefenseLabFrame[]; evaluation: DefenseLabSnapshot["evaluation"] } {
  const frames: DefenseLabFrame[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const processed = transactions.slice(0, index + 1);
    const event = events[index];
    const linkedClusters = clusters
      .filter((cluster) => cluster.transactionIds.includes(event.transactionId))
      .map((cluster) => cluster.id);
    const { cards } = buildMetricSet(processed, transactions, config, overrides);

    frames.push({
      tick: event.tick,
      headline: event.title,
      subline:
        event.outcome === "hold"
          ? "The connected evidence is strong enough to stop the payout before money moves."
          : event.outcome === "step-up"
            ? "An extra identity check can reduce the risk without immediately declining the payment."
            : "The connected warning signs are not strong enough to stop the payment yet.",
      activeNodeIds: [
        `merchant_${processed[index].merchantId}`,
        `payment_${event.transactionId}`,
        ...linkedClusters,
        event.outcome === "observe" ? "verifier_step_up" : "queue_manual",
      ],
      activeEdgeIds: [
        ...linkedClusters.map((clusterId) => `${processed[index].merchantId}_${clusterId}`),
        ...linkedClusters.map((clusterId) => `${clusterId}_${event.transactionId}`),
        `payment_queue_${event.transactionId}`,
      ],
      metrics: cards,
      feed: events.slice(Math.max(0, index - 2), index + 1),
      agentActions: agentActions.filter((action) => action.tick === event.tick),
    });
  }

  const finalCards = buildMetricSet(transactions, transactions, config, overrides);

  frames.push({
    tick: events.length + 1,
    headline: "Protection test complete",
    subline: "The payment map has settled, showing how much fraud was found and how many safe payments were delayed.",
    activeNodeIds: clusters.map((cluster) => cluster.id).concat(["queue_manual", "verifier_step_up"]),
    activeEdgeIds: [],
    metrics: finalCards.cards,
    feed: events.slice(-3),
    agentActions: agentActions.filter((action) => action.tick >= events.length - 1),
  });

  return {
    frames,
    evaluation: finalCards.evaluation,
  };
}

export function buildDefenseLabSnapshot(
  input?: Partial<DefenseLabConfig> & {
    replayCohort?: ReplayCohort;
    merchantOverrides?: MerchantOverrideRecord[];
  },
): DefenseLabSnapshot {
  const config = mergeConfig(input);
  const replayCohort = input?.replayCohort ?? DEFAULT_REPLAY_COHORT;
  const overrides = input?.merchantOverrides ?? [];
  const snapshot = getDashboardSnapshot();
  const transactions = buildReplayTransactions(snapshot.transactions, replayCohort);
  const clusters = buildClusters(transactions);
  const nodes = buildNodes(transactions, clusters, config, overrides);
  const edges = buildEdges(transactions, clusters, config, overrides);
  const modelArtifacts = buildFraudModel(snapshot.transactions, transactions);
  const seededEvents = buildEvents(
    transactions,
    config,
    overrides,
    replayCohort,
    modelArtifacts.insightsByTransaction,
  );
  const agentSimulation = buildAgentActions({
    transactions,
    events: seededEvents,
    clusters,
    config,
    model: modelArtifacts.model,
    insightsByTransaction: modelArtifacts.insightsByTransaction,
  });
  const eventActions = agentSimulation.actions.reduce(
    (accumulator, action) => {
      const current = accumulator.get(action.tick) ?? [];
      current.push(action);
      accumulator.set(action.tick, current);
      return accumulator;
    },
    new Map<number, DefenseAgentAction[]>(),
  );
  const events = seededEvents.map((event) => ({
    ...event,
    agentActions: eventActions.get(event.tick) ?? [],
  }));
  const { frames, evaluation } = buildFrames(
    transactions,
    events,
    clusters,
    config,
    overrides,
    agentSimulation.actions,
  );

  const highestPressureCluster = clusters[0];
  const recommendation =
    evaluation.falsePositiveRate > 0.35
      ? "Raise the threshold by 2 points or narrow auto-holds to merchants already under chargeback watch."
      : evaluation.recall < 0.7
        ? "Lower the threshold for hyperlocal and travel flows, but keep auto-hold reserved for multi-signal collisions."
        : "Current policy is balanced enough for a live pilot. Keep the verifier path on and expand velocity clamping.";

  return {
    generatedAt: new Date("2026-09-01T10:35:00.000Z").toISOString(),
    config,
    nodes,
    edges,
    frames,
    events,
    clusters,
    agentRoster: agentSimulation.roster,
    agentActions: agentSimulation.actions,
    model: modelArtifacts.model,
    evaluation,
    summary: {
      title: highestPressureCluster
        ? `${highestPressureCluster.label} is the dominant live abuse pattern`
        : "No coordinated pressure detected",
      subtitle: highestPressureCluster
        ? `${highestPressureCluster.transactionIds.length} linked payments are converging across ${highestPressureCluster.merchantIds.length} merchants in the ${replayCohort.replaceAll("_", " ")} cohort.`
        : "The queue is stable under the current defense policy.",
      recommendation,
      measurableOutcome: `${ratio(evaluation.precision)} of blocked payments were risky, ${ratio(evaluation.recall)} of likely fraud was found, and reviewing safe payments cost an estimated ${money(Math.round(evaluation.falsePositiveCost))} in this test.`,
    },
  };
}
