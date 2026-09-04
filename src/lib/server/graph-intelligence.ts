import { money } from "@/lib/format";
import type { GraphClusterRecord, GraphEdgeRecord, GraphNodeRecord, GraphSnapshotRecord } from "@/types/ops";
import type { RiskTransaction } from "@/types/risk";

type SignalDefinition = {
  code: string;
  label: string;
  match: (transaction: RiskTransaction) => boolean;
};

const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    code: "new_device",
    label: "Fresh device burst",
    match: (transaction) => transaction.deviceAgeDays <= 1,
  },
  {
    code: "geo_shift",
    label: "Geo deviation ring",
    match: (transaction) => transaction.geoDistanceKm >= 1000,
  },
  {
    code: "retry_cluster",
    label: "Retry pressure cluster",
    match: (transaction) => transaction.attempts >= 3,
  },
  {
    code: "history",
    label: "Chargeback-linked ring",
    match: (transaction) => transaction.previousChargebacks >= 2,
  },
  {
    code: "velocity",
    label: "Velocity collision",
    match: (transaction) => transaction.ipVelocity >= 7,
  },
];

function severityFromScore(score: number): GraphClusterRecord["severity"] {
  if (score >= 85) return "critical";
  if (score >= 68) return "high";
  return "medium";
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildSignalCluster(
  signal: SignalDefinition,
  transactions: RiskTransaction[],
): GraphClusterRecord | null {
  const members = transactions.filter(signal.match);

  if (members.length === 0) {
    return null;
  }

  const merchantIds = [...new Set(members.map((transaction) => transaction.merchantId))];
  const customerIds = [...new Set(members.map((transaction) => transaction.customer))];
  const exposure = members.reduce((total, transaction) => total + transaction.amount, 0);
  const averageScore = Math.round(average(members.map((transaction) => transaction.score)));
  const queuePressure = Math.round(
    averageScore * 0.45 + merchantIds.length * 9 + customerIds.length * 6 + members.length * 5,
  );

  return {
    id: `graph_${signal.code}`,
    label: signal.label,
    summary: `${members.length} risky payments worth ${money(exposure)} are sharing ${signal.label.toLowerCase()} behavior across ${merchantIds.length} merchants.`,
    severity: severityFromScore(averageScore),
    averageScore,
    exposure,
    merchantIds,
    transactionIds: members.map((transaction) => transaction.id),
    customerIds,
    sharedSignals: [...new Set(members.flatMap((transaction) => transaction.triggers.map((trigger) => trigger.label)))].slice(0, 4),
    queuePressure,
  };
}

export function buildGraphSnapshot(transactions: RiskTransaction[]): GraphSnapshotRecord {
  const riskyTransactions = transactions.filter((transaction) => transaction.score >= 68);
  const clusters = SIGNAL_DEFINITIONS.map((signal) => buildSignalCluster(signal, riskyTransactions))
    .filter((cluster): cluster is GraphClusterRecord => cluster !== null)
    .sort((left, right) => right.queuePressure - left.queuePressure)
    .slice(0, 4);

  const nodes = new Map<string, GraphNodeRecord>();
  const edges: GraphEdgeRecord[] = [];

  for (const cluster of clusters) {
    nodes.set(cluster.id, {
      id: cluster.id,
      kind: "signal",
      label: cluster.label,
      risk: cluster.averageScore,
    });

    for (const transactionId of cluster.transactionIds) {
      const transaction = riskyTransactions.find((item) => item.id === transactionId);

      if (!transaction) continue;

      const merchantNodeId = `merchant_${transaction.merchantId}`;
      const paymentNodeId = `payment_${transaction.id}`;
      const customerNodeId = `customer_${transaction.customer}`;

      nodes.set(merchantNodeId, {
        id: merchantNodeId,
        kind: "merchant",
        label: transaction.merchantName,
        risk: transaction.score,
      });
      nodes.set(paymentNodeId, {
        id: paymentNodeId,
        kind: "payment",
        label: transaction.id,
        risk: transaction.score,
      });
      nodes.set(customerNodeId, {
        id: customerNodeId,
        kind: "customer",
        label: transaction.customer,
        risk: Math.max(28, transaction.score - 6),
      });

      edges.push(
        {
          id: `${cluster.id}_${merchantNodeId}`,
          source: merchantNodeId,
          target: cluster.id,
          relation: "merchant_overlap",
          strength: 0.72,
        },
        {
          id: `${cluster.id}_${paymentNodeId}`,
          source: cluster.id,
          target: paymentNodeId,
          relation: "signal_hit",
          strength: 0.94,
        },
        {
          id: `${paymentNodeId}_${customerNodeId}`,
          source: paymentNodeId,
          target: customerNodeId,
          relation: "customer_trace",
          strength: 0.58,
        },
      );
    }
  }

  return {
    id: `graph_${new Date("2026-08-23T00:00:00.000Z").toISOString()}`,
    generatedAt: new Date("2026-08-23T00:00:00.000Z").toISOString(),
    nodes: [...nodes.values()],
    edges,
    clusters,
  };
}
