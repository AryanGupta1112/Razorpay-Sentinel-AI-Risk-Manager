import type {
  DefenseAgent,
  DefenseAgentAction,
  DefenseLabCluster,
  DefenseLabConfig,
  DefenseLabEvent,
  DefenseMlInsight,
  DefenseMlModelSummary,
  RiskTransaction,
} from "@/types/risk";

const AGENT_ROSTER: DefenseAgent[] = [
  {
    id: "agent_signal_scout",
    name: "Signal Scout",
    role: "signal_scout",
    mission: "Finds unusual patterns across devices, retries, and location changes.",
    style: "critical",
  },
  {
    id: "agent_merchant_guard",
    name: "Merchant Guard",
    role: "merchant_guard",
    mission: "Tracks which business is getting hit and suggests safer limits.",
    style: "watch",
  },
  {
    id: "agent_policy_guard",
    name: "Policy Guard",
    role: "policy_guard",
    mission: "Checks whether the current rules are too loose, too strict, or balanced.",
    style: "control",
  },
  {
    id: "agent_queue_ops",
    name: "Queue Ops",
    role: "queue_coordinator",
    mission: "Keeps the review team from getting overloaded and routes work cleanly.",
    style: "ops",
  },
];

function round(value: number, digits = 2) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function makeAction(
  tick: number,
  agent: DefenseAgent,
  target: Pick<DefenseAgentAction, "targetType" | "targetId" | "targetLabel">,
  action: string,
  reasoning: string,
  confidence: number,
): DefenseAgentAction {
  return {
    id: `${agent.id}_${target.targetId}_${tick}_${action.replace(/\s+/g, "_")}`,
    tick,
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    targetType: target.targetType,
    targetId: target.targetId,
    targetLabel: target.targetLabel,
    action,
    reasoning,
    confidence: round(confidence, 3),
  };
}

export function buildAgentActions(input: {
  transactions: RiskTransaction[];
  events: DefenseLabEvent[];
  clusters: DefenseLabCluster[];
  config: DefenseLabConfig;
  model: DefenseMlModelSummary;
  insightsByTransaction: Record<string, DefenseMlInsight>;
}) {
  const merchantHighRiskCounts = input.transactions.reduce(
    (accumulator, transaction) => {
      if (transaction.score >= input.config.threshold) {
        accumulator.set(transaction.merchantId, (accumulator.get(transaction.merchantId) ?? 0) + 1);
      }
      return accumulator;
    },
    new Map<string, number>(),
  );

  const clusterByTransaction = new Map<string, DefenseLabCluster>();
  for (const cluster of input.clusters) {
    for (const transactionId of cluster.transactionIds) {
      if (!clusterByTransaction.has(transactionId)) {
        clusterByTransaction.set(transactionId, cluster);
      }
    }
  }

  const actions: DefenseAgentAction[] = [];

  for (const event of input.events) {
    const transaction = input.transactions.find((item) => item.id === event.transactionId);
    const insight = input.insightsByTransaction[event.transactionId];
    if (!transaction || !insight) continue;

    const cluster = clusterByTransaction.get(transaction.id);
    const merchantHitCount = merchantHighRiskCounts.get(transaction.merchantId) ?? 1;
    const reviewPressure = Math.max(0, event.tick - input.config.analystCapacity);

    if (cluster && insight.probability >= 0.7) {
      actions.push(
        makeAction(
          event.tick,
          AGENT_ROSTER[0],
          { targetType: "cluster", targetId: cluster.id, targetLabel: cluster.label },
          "escalate cluster confidence",
          `${cluster.label} has ${cluster.transactionIds.length} linked payments and ${(insight.probability * 100).toFixed(
            0,
          )}% fraud probability on ${transaction.id}.`,
          Math.max(insight.confidence, 0.62),
        ),
      );
    } else {
      actions.push(
        makeAction(
          event.tick,
          AGENT_ROSTER[0],
          { targetType: "payment", targetId: transaction.id, targetLabel: transaction.id },
          "keep watching for connected warning signs",
          `${transaction.id} is not yet part of a strong linked pattern, but its ${transaction.triggers.slice(0, 2).map((trigger) => trigger.label.toLowerCase()).join(" and ") || "unusual business activity"} needs one more related warning sign.`,
          Math.max(0.54, insight.confidence * 0.86),
        ),
      );
    }

    if (merchantHitCount >= 2) {
      actions.push(
        makeAction(
          event.tick,
          AGENT_ROSTER[1],
          {
            targetType: "merchant",
            targetId: transaction.merchantId,
            targetLabel: transaction.merchantName,
          },
          "temporarily limit this business",
          `${transaction.merchantName} now has ${merchantHitCount} risky payments in this test, so this is probably a business-wide problem rather than one unusual payment.`,
          Math.max(0.58, insight.confidence),
        ),
      );
    } else {
      actions.push(
        makeAction(
          event.tick,
          AGENT_ROSTER[1],
          {
            targetType: "merchant",
            targetId: transaction.merchantId,
            targetLabel: transaction.merchantName,
          },
          "compare with this business's normal activity",
          `${transaction.merchantName} has one risky payment in this test, so only act on that payment unless a second one shows the same warning signs.`,
          Math.max(0.53, insight.confidence * 0.84),
        ),
      );
    }

    if (insight.probability >= 0.82 && event.outcome !== "hold") {
      actions.push(
        makeAction(
          event.tick,
          AGENT_ROSTER[2],
          { targetType: "policy", targetId: "policy_live", targetLabel: "Live policy" },
          "recommend stricter review rules",
          `The system is ${(insight.confidence * 100).toFixed(0)}% confident about ${transaction.id}, but the current rules only chose ${event.outcome}.`,
          Math.max(insight.confidence, input.model.precision),
        ),
      );
    } else {
      actions.push(
        makeAction(
          event.tick,
          AGENT_ROSTER[2],
          { targetType: "payment", targetId: transaction.id, targetLabel: transaction.id },
          event.outcome === "hold" ? "agree with the automatic hold" : "agree with the extra identity check",
          `The risk estimate and current rules agree on what should happen to ${transaction.id}.`,
          Math.max(0.55, insight.confidence * 0.92),
        ),
      );
    }

    actions.push(
      makeAction(
        event.tick,
        AGENT_ROSTER[3],
        { targetType: "queue", targetId: "queue_manual", targetLabel: "Manual review queue" },
        reviewPressure > 0 ? "move reviewers to the busiest queue" : "keep reviews moving",
        reviewPressure > 0
          ? `There are ${reviewPressure} more waiting payments than the team can handle at once, so the least urgent reviews will wait.`
          : `The waiting payments fit within the team's capacity to review ${input.config.analystCapacity} at once.`,
        reviewPressure > 0 ? 0.71 : 0.6,
      ),
    );
  }

  return {
    roster: AGENT_ROSTER,
    actions,
  };
}
