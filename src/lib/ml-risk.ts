import { money } from "@/lib/format";
import type { DefenseMlDriver, DefenseMlInsight, DefenseMlModelSummary, RiskTransaction } from "@/types/risk";

type FeatureDefinition = {
  key: string;
  label: string;
  value: (transaction: RiskTransaction) => number;
  format: (transaction: RiskTransaction) => string;
};

type TrainingRow = {
  features: number[];
  label: 0 | 1;
};

type FraudModelArtifacts = {
  model: DefenseMlModelSummary;
  insightsByTransaction: Record<string, DefenseMlInsight>;
};

const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    key: "amount",
    label: "High-ticket amount",
    value: (transaction) => Math.min(transaction.amount / 150000, 1.4),
    format: (transaction) => money(transaction.amount),
  },
  {
    key: "new_device",
    label: "Fresh device age",
    value: (transaction) => Math.max(0, 1 - Math.min(transaction.deviceAgeDays / 10, 1)),
    format: (transaction) => `${transaction.deviceAgeDays} day${transaction.deviceAgeDays === 1 ? "" : "s"}`,
  },
  {
    key: "geo_shift",
    label: "Geo deviation",
    value: (transaction) => Math.min(transaction.geoDistanceKm / 1800, 1.5),
    format: (transaction) => `${Math.round(transaction.geoDistanceKm)} km`,
  },
  {
    key: "retry_pressure",
    label: "Retry pressure",
    value: (transaction) => Math.min(transaction.attempts / 5, 1.4),
    format: (transaction) => `${transaction.attempts} attempts`,
  },
  {
    key: "ip_velocity",
    label: "IP velocity",
    value: (transaction) => Math.min(transaction.ipVelocity / 10, 1.5),
    format: (transaction) => `${transaction.ipVelocity} hops`,
  },
  {
    key: "chargeback_history",
    label: "Chargeback history",
    value: (transaction) => Math.min(transaction.previousChargebacks / 4, 1.5),
    format: (transaction) => `${transaction.previousChargebacks} prior chargebacks`,
  },
  {
    key: "night_traffic",
    label: "Off-hour traffic",
    value: (transaction) => (transaction.nightTraffic ? 1 : 0),
    format: (transaction) => (transaction.nightTraffic ? "night traffic" : "day traffic"),
  },
  {
    key: "card_method",
    label: "Card checkout",
    value: (transaction) => (transaction.method === "Card" ? 1 : 0),
    format: (transaction) => transaction.method,
  },
];

const MODEL_THRESHOLD = 0.58;
let modelCache: { key: string; artifacts: FraudModelArtifacts } | null = null;

function sigmoid(value: number) {
  if (value < -30) return 0;
  if (value > 30) return 1;
  return 1 / (1 + Math.exp(-value));
}

function deterministicRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 3) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function isFraudLike(transaction: RiskTransaction) {
  const signalCount = transaction.triggers.filter((trigger) =>
    ["high_amount", "new_device", "geo_shift", "retry_cluster", "velocity", "history"].includes(trigger.code),
  ).length;

  return (
    transaction.score >= 86 ||
    (signalCount >= 4 && transaction.amount >= 50000) ||
    (transaction.deviceAgeDays <= 1 && transaction.previousChargebacks >= 2) ||
    (transaction.geoDistanceKm >= 1000 && transaction.ipVelocity >= 7 && transaction.attempts >= 3)
  );
}

function mutateTransaction(base: RiskTransaction, seed: number): RiskTransaction {
  const random = deterministicRandom(seed);
  const amountFactor = 0.82 + random() * 0.52;
  const geoFactor = 0.72 + random() * 0.9;
  const velocityJitter = Math.round((random() - 0.25) * 4);
  const attemptJitter = Math.round(random() * 2);
  const chargebackJitter = random() > 0.7 ? 1 : 0;
  const syntheticNightTraffic = random() > 0.55 ? true : base.nightTraffic;

  const deviceAgeDays =
    base.deviceAgeDays <= 1
      ? Math.max(0, Math.round(base.deviceAgeDays + (random() > 0.6 ? 0 : random() * 2)))
      : Math.max(0, Math.round(base.deviceAgeDays * (0.35 + random())));

  return {
    ...base,
    id: `${base.id}_synthetic_${seed}`,
    amount: Math.round(base.amount * amountFactor),
    geoDistanceKm: Math.round(base.geoDistanceKm * geoFactor),
    attempts: clamp(base.attempts + attemptJitter, 1, 5),
    ipVelocity: clamp(base.ipVelocity + velocityJitter, 1, 10),
    previousChargebacks: clamp(base.previousChargebacks + chargebackJitter, 0, 4),
    nightTraffic: syntheticNightTraffic,
    deviceAgeDays,
    score: clamp(
      base.score +
        Math.round((base.deviceAgeDays <= 1 ? 3 : -1) + (syntheticNightTraffic ? 2 : -1) + (random() - 0.5) * 8),
      12,
      99,
    ),
  };
}

function featureVector(transaction: RiskTransaction) {
  return FEATURE_DEFINITIONS.map((feature) => feature.value(transaction));
}

function buildTrainingRows(transactions: RiskTransaction[]): TrainingRow[] {
  const rows: TrainingRow[] = [];

  transactions.forEach((transaction, index) => {
    rows.push({
      features: featureVector(transaction),
      label: isFraudLike(transaction) ? 1 : 0,
    });

    for (let variant = 0; variant < 18; variant += 1) {
      const synthetic = mutateTransaction(transaction, index * 977 + variant * 37 + 11);
      rows.push({
        features: featureVector(synthetic),
        label: isFraudLike(synthetic) ? 1 : 0,
      });
    }
  });

  return rows;
}

function dotProduct(left: number[], right: number[]) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

function trainModel(rows: TrainingRow[]) {
  const splitIndex = Math.max(12, Math.floor(rows.length * 0.8));
  const trainingRows = rows.slice(0, splitIndex);
  const holdoutRows = rows.slice(splitIndex);
  const weights = new Array(FEATURE_DEFINITIONS.length).fill(0);
  let bias = 0;
  const learningRate = 0.18;
  const regularization = 0.002;

  for (let epoch = 0; epoch < 260; epoch += 1) {
    for (const row of trainingRows) {
      const prediction = sigmoid(dotProduct(weights, row.features) + bias);
      const error = prediction - row.label;

      for (let index = 0; index < weights.length; index += 1) {
        weights[index] -= learningRate * (error * row.features[index] + regularization * weights[index]);
      }

      bias -= learningRate * error;
    }
  }

  const evaluateRows = holdoutRows.length > 0 ? holdoutRows : trainingRows;
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const row of evaluateRows) {
    const prediction = sigmoid(dotProduct(weights, row.features) + bias);
    const flagged = prediction >= MODEL_THRESHOLD;

    if (flagged && row.label === 1) truePositive += 1;
    if (flagged && row.label === 0) falsePositive += 1;
    if (!flagged && row.label === 0) trueNegative += 1;
    if (!flagged && row.label === 1) falseNegative += 1;
  }

  const precision =
    truePositive === 0 && falsePositive === 0
      ? 1
      : truePositive / Math.max(truePositive + falsePositive, 1);
  const recall = truePositive / Math.max(truePositive + falseNegative, 1);
  const accuracy = (truePositive + trueNegative) / Math.max(evaluateRows.length, 1);

  return {
    weights,
    bias,
    trainingSamples: trainingRows.length,
    holdoutSamples: evaluateRows.length,
    precision,
    recall,
    accuracy,
  };
}

function describeModelStatus(precision: number, recall: number) {
  if (precision >= 0.8 && recall >= 0.74) {
    return {
      status: "stable" as const,
      summary: "The replay model is catching multi-signal fraud cleanly enough to guide live agent decisions.",
    };
  }

  if (precision >= 0.68 && recall >= 0.62) {
    return {
      status: "watch" as const,
      summary: "The replay model is directionally useful, but a risk lead should still verify borderline holds.",
    };
  }

  return {
    status: "elevated" as const,
    summary: "Model recall is soft on this cohort. Keep the verifier and merchant agents conservative.",
  };
}

function transactionInsight(
  transaction: RiskTransaction,
  weights: number[],
  bias: number,
): DefenseMlInsight {
  const features = featureVector(transaction);
  const probability = sigmoid(dotProduct(weights, features) + bias);
  const confidence = Math.abs(probability - 0.5) * 2;
  const topDrivers = FEATURE_DEFINITIONS.map((feature, index) => {
    const impact = weights[index] * features[index];

    return {
      feature: feature.key,
      label: feature.label,
      value: feature.format(transaction),
      impact,
      direction: impact >= 0 ? "up" : "down",
    } satisfies DefenseMlDriver;
  })
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    .slice(0, 3)
    .map((driver) => ({
      ...driver,
      impact: round(driver.impact, 3),
    }));

  return {
    probability,
    confidence,
    verdict: probability >= 0.72 ? "fraud_likely" : probability >= 0.48 ? "review" : "safe",
    topDrivers,
  };
}

export function buildFraudModel(
  trainingTransactions: RiskTransaction[],
  replayTransactions: RiskTransaction[],
): FraudModelArtifacts {
  const cacheKey = [
    trainingTransactions.map((transaction) => `${transaction.id}:${transaction.score}:${transaction.amount}`).join("|"),
    replayTransactions.map((transaction) => `${transaction.id}:${transaction.score}:${transaction.amount}`).join("|"),
  ].join("::");

  if (modelCache?.key === cacheKey) {
    return modelCache.artifacts;
  }

  const rows = buildTrainingRows(trainingTransactions);
  const trained = trainModel(rows);
  const modelState = describeModelStatus(trained.precision, trained.recall);
  const insightsByTransaction = Object.fromEntries(
    replayTransactions.map((transaction) => [
      transaction.id,
      transactionInsight(transaction, trained.weights, trained.bias),
    ]),
  ) as Record<string, DefenseMlInsight>;

  const artifacts: FraudModelArtifacts = {
    model: {
      label: "Sentinel Logistic Detector",
      trainingSamples: trained.trainingSamples,
      holdoutSamples: trained.holdoutSamples,
      threshold: MODEL_THRESHOLD,
      precision: trained.precision,
      recall: trained.recall,
      accuracy: trained.accuracy,
      status: modelState.status,
      summary: modelState.summary,
    },
    insightsByTransaction,
  };

  modelCache = { key: cacheKey, artifacts };
  return artifacts;
}
