import { money } from "@/lib/format";
import type {
  AgentApprovalRequestRecord,
  AgentMemoryRecord,
  AgentTelemetryRecord,
  AuditEventRecord,
  CaseCommentRecord,
  GraphSnapshotRecord,
  MerchantOverrideRecord,
  PolicyArtifactRecord,
  ReviewCaseRecord,
  SimulatorRunRecord,
} from "@/types/ops";
import {
  DashboardSnapshot,
  DefenseLabConfig,
  DefenseLabSnapshot,
  MerchantInsight,
  ReplayCohort,
  RiskTransaction,
} from "@/types/risk";

export type ConsoleScreen =
  | "overview"
  | "copilot"
  | "control-room"
  | "simulator"
  | "alerts"
  | "merchants"
  | "transactions"
  | "admin";
type ConsoleSeverity = "critical" | "high" | "medium" | "low";
type ConsoleTxStatus = "held" | "declined" | "success" | "processing";
type ConsoleNodeRisk = "critical" | "high" | "medium" | "safe" | "held";
type ConsoleNodeType = "merchant" | "customer" | "payment" | "cluster" | "verifier" | "queue";
type ConsoleEdgeType = "fraud" | "suspicious" | "hold" | "safe" | "normal";

type ConsoleQueuePoint = { v: number };

type ConsoleCluster = {
  id: string;
  name: string;
  severity: ConsoleSeverity;
  merchants: number;
  txns: number;
  exposure: string;
  velocity: string;
  status: string;
  linkedIPs: number;
  age: string;
};

type ConsoleAlert = {
  id: string;
  caseId: string;
  title: string;
  cluster: string | null;
  merchantId: string;
  merchant: string;
  mid: string;
  severity: ConsoleSeverity;
  type: string;
  txns: number;
  exposure: string;
  time: string;
  score: number;
  reason: string;
  recommendation: string;
  assignee: string;
  auditNote: string | null;
  comments: Array<{ author: string; content: string; createdAt: string }>;
  status: "open" | "investigating" | "held" | "escalated" | "dismissed";
};

type ConsoleMerchant = {
  id: string;
  name: string;
  category: string;
  region: string;
  owner: string;
  tier: string;
  riskScore: number;
  riskLevel: ConsoleSeverity;
  txnVolume: string;
  cbRate: string;
  fraudRate: string;
  alerts: number;
  holdPct: string;
  override?: {
    strategy: "strict" | "balanced" | "lenient";
    summary: string;
  };
};

type ConsoleTransaction = {
  id: string;
  merchant: string;
  amount: string;
  status: ConsoleTxStatus;
  score: number;
  method: string;
  bin: string | null;
  time: string;
  flag: string | null;
  ip: string;
  device: string;
};

type ConsoleMessage = {
  id: number;
  role: "user" | "assistant";
  time: string;
  content: string;
};

export type ConsoleSimNode = {
  id: string;
  type: ConsoleNodeType;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  risk: ConsoleNodeRisk;
  r: number;
  meta?: Record<string, string>;
};

export type ConsoleSimEdge = {
  id: string;
  from: string;
  to: string;
  type: ConsoleEdgeType;
};

type ConsoleSimFrame = {
  tick: number;
  headline: string;
  subline: string;
  activeNodeIds: string[];
  activeEdgeIds: string[];
  metricCards: Array<{ label: string; value: string; tone: "neutral" | "good" | "warn" | "bad" }>;
  agentActions: Array<{
    id: string;
    agentName: string;
    role: string;
    action: string;
    reasoning: string;
    confidence: number;
  }>;
  feed: Array<{
    id: string;
    title: string;
    summary: string;
    action: string;
    amount: string;
    score: number;
    outcome: "observe" | "step-up" | "hold";
    probability: string;
    confidence: string;
    agentLine: string;
  }>;
};

export type ConsoleData = {
  generatedAt: string;
  copilotProviderLabel: string;
  queueData: ConsoleQueuePoint[];
  overview: {
    riskScore: number;
    riskStateLabel: string;
    riskDelta: string;
    queuePressure: number;
    queueLabel: string;
    fpCost: string;
    fpTrend: string;
    totals: Array<{ label: string; value: string; color: string }>;
    modelMetrics: Array<{ label: string; value: string; pct: number; tone: string; sub: string }>;
    systemStatus: string;
    caseStats: Array<{ label: string; value: string }>;
    challenger?: { label: string; delta: string; recommendation: string };
    drift?: { label: string; tone: "good" | "warn" | "bad"; summary: string };
  };
  clusters: ConsoleCluster[];
  alerts: ConsoleAlert[];
  merchants: ConsoleMerchant[];
  transactions: ConsoleTransaction[];
  suggestions: string[];
  initialMessages: ConsoleMessage[];
  copilotContext: {
    merchant: { name: string; mid: string; severity: ConsoleSeverity; score: number };
    alert: { id: string; title: string; cluster: string; time: string };
    recentActions: Array<{ label: string; sub: string; color: string }>;
  };
  simulator: {
    title: string;
    statsLabel: string;
    activeRunLabel: string;
    replayCohort: ReplayCohort;
    config: DefenseLabConfig;
    comparison?: {
      baselineLabel: string;
      challengerLabel: string;
      recommendation: string;
      metrics: Array<{
        label: string;
        baseline: string;
        challenger: string;
        delta: string;
        tone: "good" | "warn" | "bad";
      }>;
    };
    sessionTimeline: Array<{
      id: string;
      tick: number;
      title: string;
      effect: string;
      actor: string;
      time: string;
      source: "agent" | "analyst";
    }>;
    agentRoster: Array<{
      id: string;
      name: string;
      role: string;
      mission: string;
      status: string;
    }>;
    model: {
      label: string;
      precision: string;
      recall: string;
      accuracy: string;
      threshold: string;
      samples: string;
      status: "stable" | "watch" | "elevated";
      summary: string;
    };
    agentMemories: Array<{
      id: string;
      agentName: string;
      title: string;
      summary: string;
      confidence: string;
      scopeLabel: string;
      tags: string[];
    }>;
    approvals: Array<{
      id: string;
      tick: number;
      agentName: string;
      targetLabel: string;
      action: string;
      rationale: string;
      status: "pending" | "approved" | "rejected";
      requestedAt: string;
      resolutionNote: string | null;
    }>;
    telemetry: Array<{
      id: string;
      agentName: string;
      role: string;
      decisions: number;
      avgConfidence: string;
      queueDelta: number;
      estimatedLossPrevented: string;
      createdAt: string;
    }>;
    deliberations: Array<{
      id: string;
      tick: number;
      title: string;
      summary: string;
      merchantName: string;
      transactionId: string;
      amount: string;
      riskScore: number;
      outcome: "observe" | "step-up" | "hold";
      messages: Array<{
        id: string;
        agentName: string;
        role: string;
        text: string;
        time: string;
        kind: "observation" | "assessment" | "recommendation" | "operations";
      }>;
      consensus: {
        action: string;
        rationale: string;
        confidence: string;
        votes: number;
        status: "pending" | "approved" | "rejected" | "informational";
        approvalId: string | null;
      };
    }>;
    activity: Array<{
      id: string;
      tick: number;
      type: "message" | "decision" | "approval";
      actor: string;
      target: string;
      message: string;
      time: string;
    }>;
    nodes: ConsoleSimNode[];
    edges: ConsoleSimEdge[];
    frames: ConsoleSimFrame[];
    summaryTitle: string;
    summarySubtitle: string;
    liveStats: Array<{ label: string; value: string; color: string }>;
  };
};

type SimulatorLane = "merchant" | "cluster" | "payment" | "customer" | "control";

const percentage = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value: number) {
  return `${percentage.format(value)}%`;
}

function formatClock(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function relativeFrom(baseIso: string, targetIso: string) {
  const delta = Math.max(0, new Date(baseIso).getTime() - new Date(targetIso).getTime());
  const minutes = Math.round(delta / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function severityFromScore(score: number): ConsoleSeverity {
  if (score >= 85) return "critical";
  if (score >= 68) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function toTxStatus(transaction: RiskTransaction, autoHoldThreshold: number): ConsoleTxStatus {
  if (transaction.score >= autoHoldThreshold) return "held";
  if (transaction.status === "failed") return "declined";
  if (transaction.status === "pending" || transaction.status === "refunded") return "processing";
  return "success";
}

function buildTitle(transaction: RiskTransaction) {
  const primary = transaction.triggers[0]?.label ?? "Risk signal";

  if (primary === "High-ticket payment") return "High-value payment collision";
  if (primary === "Fresh device fingerprint") return "Fresh-device burst detected";
  if (primary === "Large geo deviation") return "Geo-deviation ring detected";
  if (primary === "Multiple retry attempts") return "Retry pressure threshold breached";
  return `${primary} escalation`;
}

function deriveTier(merchant: MerchantInsight) {
  if (merchant.monthlyVolume >= 2200000) return "T1";
  if (merchant.monthlyVolume >= 1400000) return "T2";
  return "T3";
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function f1Score(precision: number, recall: number) {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function toNodeRisk(score: number, status: string): ConsoleNodeRisk {
  if (status === "blocked") return "held";
  if (score >= 88) return "critical";
  if (score >= 68) return "high";
  if (score >= 45) return "medium";
  return "safe";
}

function toNodeType(type: string): ConsoleNodeType {
  if (type === "queue") return "queue";
  return type as ConsoleNodeType;
}

function edgeTypeFromSnapshot(status: string, label: string): ConsoleEdgeType {
  if (status === "blocked") return "hold";
  if (label.includes("challenge")) return "safe";
  if (label.includes("auto-hold")) return "hold";
  if (label.includes("signal")) return "fraud";
  if (status === "active") return "suspicious";
  return "normal";
}

function deviceLabel(transaction: RiskTransaction) {
  if (transaction.method === "UPI") return transaction.deviceAgeDays <= 1 ? "Android / New device" : "Android / Known device";
  if (transaction.method === "Card") return transaction.deviceAgeDays <= 1 ? "iOS / Fresh session" : "Web / Returning device";
  if (transaction.method === "Wallet") return "Wallet / App session";
  return "Netbanking / Web session";
}

function ipLabel(transaction: RiskTransaction) {
  return `velocity ${transaction.ipVelocity} · ${transaction.geoDistanceKm}km`;
}

function buildQueueData(snapshot: DashboardSnapshot): ConsoleQueuePoint[] {
  return snapshot.trends.slice(-10).map((trend) => ({
    v: Math.max(24, Math.round(trend.riskVolume / 1800 + trend.failedPayments * 7 + trend.disputes * 5)),
  }));
}

function buildClusters(snapshot: DashboardSnapshot): ConsoleCluster[] {
  return snapshot.cases.slice(0, 4).map((alertCase, index) => {
    const related = snapshot.transactions.filter((transaction) => transaction.merchantName === alertCase.merchantName);
    const linkedIPs = Math.round(average(related.map((transaction) => transaction.ipVelocity))) + related.length;
    const exposure = related
      .filter((transaction) => transaction.score >= 68)
      .reduce((total, transaction) => total + transaction.amount, 0);
    const pressure = Math.round(average(related.map((transaction) => transaction.score)));

    return {
      id: alertCase.id.toUpperCase(),
      name: `${alertCase.merchantName} pressure cluster`,
      severity: severityFromScore(pressure),
      merchants: 1,
      txns: related.length,
      exposure: money(exposure || related[0]?.amount || 0),
      velocity: `+${Math.max(3, Math.round(pressure / 7))}/hr`,
      status: index === 0 ? "active" : pressure >= 80 ? "investigating" : "monitoring",
      linkedIPs,
      age: relativeFrom(snapshot.generatedAt, related[0]?.createdAt ?? snapshot.generatedAt),
    };
  });
}

function buildClustersFromGraph(snapshot: DashboardSnapshot, graph?: GraphSnapshotRecord): ConsoleCluster[] {
  if (!graph?.clusters.length) {
    return buildClusters(snapshot);
  }

  return graph.clusters.slice(0, 4).map((cluster) => ({
    id: cluster.id.toUpperCase(),
    name: cluster.label,
    severity: severityFromScore(cluster.averageScore),
    merchants: cluster.merchantIds.length,
    txns: cluster.transactionIds.length,
    exposure: money(cluster.exposure),
    velocity: `Q${cluster.queuePressure}/100`,
    status: cluster.severity === "critical" ? "active" : "investigating",
    linkedIPs: cluster.customerIds.length + cluster.sharedSignals.length,
    age: relativeFrom(snapshot.generatedAt, snapshot.generatedAt),
  }));
}

function latestAuditNote(caseId: string, auditEvents: AuditEventRecord[]) {
  return auditEvents.find((event) => event.caseId === caseId)?.note ?? null;
}

function buildAlerts(
  snapshot: DashboardSnapshot,
  cases: ReviewCaseRecord[] = [],
  auditEvents: AuditEventRecord[] = [],
  caseComments: CaseCommentRecord[] = [],
): ConsoleAlert[] {
  const casesByTransaction = new Map(cases.map((reviewCase) => [reviewCase.transactionId, reviewCase]));

  return snapshot.alerts.map((alert) => {
    const reviewCase = casesByTransaction.get(alert.id);
    const comments = reviewCase
      ? caseComments
          .filter((comment) => comment.caseId === reviewCase.id)
          .slice(-2)
          .map((comment) => ({
            author: comment.author,
            content: comment.content,
            createdAt: comment.createdAt,
          }))
      : [];

    return {
      id: reviewCase?.alertId ?? `ALT-${alert.id.replace(/^pay_/i, "").toUpperCase()}`,
      caseId: reviewCase?.id ?? `case_${alert.id.toLowerCase()}`,
      title: reviewCase?.title ?? buildTitle(alert),
      cluster: reviewCase?.clusterId ?? alert.triggers[0]?.code ?? null,
      merchantId: alert.merchantId.toLowerCase(),
      merchant: alert.merchantName,
      mid: alert.merchantId.toUpperCase(),
      severity: severityFromScore(alert.score),
      type: reviewCase?.type ?? alert.triggers[0]?.code ?? "risk_signal",
      txns: alert.triggers.length,
      exposure: money(alert.amount),
      time: relativeFrom(snapshot.generatedAt, alert.createdAt),
      score: alert.score,
      reason: reviewCase?.reason ?? alert.explanation,
      recommendation: reviewCase?.recommendation ?? alert.recommendation,
      assignee: reviewCase?.assignee ?? "Risk Queue",
      auditNote: reviewCase ? latestAuditNote(reviewCase.id, auditEvents) : null,
      comments,
      status: reviewCase?.status ?? (alert.score >= 90 ? "open" : "investigating"),
    };
  });
}

function buildMerchants(
  snapshot: DashboardSnapshot,
  autoHoldThreshold: number,
  overrides: MerchantOverrideRecord[] = [],
): ConsoleMerchant[] {
  const overridesByMerchant = new Map(overrides.map((override) => [override.merchantId, override]));

  return snapshot.merchants.map((merchant) => {
    const merchantTransactions = snapshot.transactions.filter(
      (transaction) => transaction.merchantId === merchant.id,
    );
    const held = merchantTransactions.filter((transaction) => transaction.score >= autoHoldThreshold).length;
    const highestScore = Math.max(...merchantTransactions.map((transaction) => transaction.score), 18);
    const override = overridesByMerchant.get(merchant.id);

    return {
      id: merchant.id.toUpperCase(),
      name: merchant.name,
      category: merchant.category,
      region: merchant.region,
      owner: merchant.owner,
      tier: deriveTier(merchant),
      riskScore: highestScore,
      riskLevel: severityFromScore(highestScore),
      txnVolume: money(merchant.monthlyVolume),
      cbRate: formatPercent(merchant.chargebackRate),
      fraudRate: formatPercent(merchant.failureRate / 3),
      alerts: merchant.flaggedTransactions,
      holdPct: formatPercent((held / Math.max(merchantTransactions.length, 1)) * 100),
      override: override
        ? {
            strategy: override.strategy,
            summary: `${override.strategy} override · threshold ${override.thresholdOffset >= 0 ? "+" : ""}${override.thresholdOffset}`,
          }
        : undefined,
    };
  });
}

function buildTransactions(snapshot: DashboardSnapshot, autoHoldThreshold: number): ConsoleTransaction[] {
  return snapshot.transactions.map((transaction) => ({
    id: transaction.id,
    merchant: transaction.merchantName,
    amount: money(transaction.amount),
    status: toTxStatus(transaction, autoHoldThreshold),
    score: transaction.score,
    method: transaction.method,
    bin: transaction.method === "Card" ? `BIN-${String(transaction.score).padStart(3, "0")}` : null,
    time: relativeFrom(snapshot.generatedAt, transaction.createdAt),
    flag: transaction.triggers[0]?.code ?? null,
    ip: ipLabel(transaction),
    device: deviceLabel(transaction),
  }));
}

function buildInitialMessages(snapshot: DashboardSnapshot, defense: DefenseLabSnapshot): ConsoleMessage[] {
  const topAlert = snapshot.alerts[0];
  const topMerchant = snapshot.merchants[0];
  const firstCluster = defense.clusters[0];

  return [
    {
      id: 1,
      role: "assistant",
      time: formatClock(snapshot.generatedAt),
      content: `Sentinel is live. ${topMerchant.name} needs the closest watch right now, and ${topAlert.id} is the payment that needs attention first. ${firstCluster ? `${firstCluster.label} is the strongest shared pattern right now.` : "There is no large shared fraud pattern leading the queue right now."}`,
    },
  ];
}

function buildSuggestions(snapshot: DashboardSnapshot) {
  const topMerchant = snapshot.merchants[0];
  const topAlert = snapshot.alerts[0];

  return [
    `Why does ${topMerchant.name} need attention first?`,
    `What should we do next for ${topAlert.id}?`,
  ];
}

function formatAgentRole(role: string) {
  const normalized = role.replaceAll("_", " ");
  const labels: Record<string, string> = {
    "signal scout": "Pattern watcher",
    "merchant guard": "Business watcher",
    "policy guard": "Rules watcher",
    "queue coordinator": "Queue manager",
  };

  return labels[normalized] ?? normalized;
}

function buildOverview(
  snapshot: DashboardSnapshot,
  defense: DefenseLabSnapshot,
  cases: ReviewCaseRecord[] = [],
  policy?: PolicyArtifactRecord,
) {
  const topScores = snapshot.alerts.slice(0, 5).map((alert) => alert.score);
  const riskScore = clamp(Math.round(average(topScores) * 0.78), 28, 98);
  const flagged = snapshot.transactions.filter((transaction) => transaction.score >= defense.config.threshold);
  const holds = cases.filter((reviewCase) => reviewCase.status === "held").length;
  const escalations = cases.filter((reviewCase) => reviewCase.status === "escalated").length;
  const paymentsBeyondCapacity = Math.max(0, flagged.length - defense.config.analystCapacity);
  const queuePressure = Math.min(
    100,
    Math.round((paymentsBeyondCapacity / Math.max(1, defense.config.analystCapacity)) * 100),
  );
  const precision = (policy?.precision ?? defense.evaluation.precision) * 100;
  const recall = (policy?.recall ?? defense.evaluation.recall) * 100;
  const f1 = f1Score(policy?.precision ?? defense.evaluation.precision, policy?.recall ?? defense.evaluation.recall) * 100;
  const falsePositiveCost = policy?.falsePositiveCost ?? defense.evaluation.falsePositiveCost;
  const falsePositiveRate = policy?.falsePositiveRate ?? defense.evaluation.falsePositiveRate;
  const drift = policy?.drift;
  const challenger = policy?.challenger;

  return {
    riskScore,
    riskStateLabel: riskScore >= 75 ? "High risk" : riskScore >= 60 ? "Needs attention" : "Stable",
    riskDelta: `${snapshot.alerts.length} payments need review right now`,
    queuePressure,
    queueLabel: `${flagged.length} payments waiting - team can review ${defense.config.analystCapacity} at once`,
    fpCost: money(Math.round(falsePositiveCost)),
    fpTrend: falsePositiveRate <= 0.2 ? "Few good payments are being stopped" : "Too many good payments may be stopped",
    totals: [
      { label: "Payments", value: String(snapshot.transactions.length), color: "text-foreground" },
      { label: "On hold", value: String(holds), color: "text-purple-400" },
      { label: "Sent up", value: String(escalations), color: "text-amber-400" },
      { label: "Blocked", value: String(flagged.length), color: "text-red-400" },
    ],
    modelMetrics: [
      { label: "Accuracy on blocked payments", value: formatPercent(precision), pct: precision, tone: "bg-emerald-500", sub: "measured on saved test cases" },
      { label: "Fraud found", value: formatPercent(recall), pct: recall, tone: "bg-primary", sub: "measured on saved test cases" },
      { label: "Balanced score", value: formatPercent(f1), pct: f1, tone: "bg-amber-400", sub: "balance between catch and caution" },
    ],
    systemStatus: snapshot.narrative,
    caseStats: [
      { label: "New", value: String(cases.filter((reviewCase) => reviewCase.status === "open").length) },
      { label: "In review", value: String(cases.filter((reviewCase) => reviewCase.status === "investigating").length) },
      { label: "On hold", value: String(holds) },
      { label: "Sent up", value: String(escalations) },
    ],
    challenger: challenger
      ? {
          label: "Test rule set",
          delta: `${challenger.precisionDelta >= 0 ? "+" : ""}${formatPercent(challenger.precisionDelta * 100)} precision · ${challenger.falsePositiveCostDelta >= 0 ? "+" : ""}${money(Math.round(challenger.falsePositiveCostDelta))} FP cost`,
          recommendation: challenger.recommendation,
        }
      : undefined,
    drift: drift
      ? {
          label: drift.status.toUpperCase(),
          tone: drift.status === "stable" ? "good" : drift.status === "watch" ? "warn" : "bad",
          summary: drift.summary,
        } as const
      : undefined,
  };
}

function buildCopilotContext(
  snapshot: DashboardSnapshot,
  defense: DefenseLabSnapshot,
  policy: PolicyArtifactRecord | undefined,
  auditEvents: AuditEventRecord[] = [],
) {
  const merchant = snapshot.merchants[0];
  const alert = snapshot.alerts[0];
  const cluster = defense.clusters[0];

  return {
    merchant: {
      name: merchant.name,
      mid: merchant.id.toUpperCase(),
      severity: severityFromScore(snapshot.transactions.find((transaction) => transaction.merchantId === merchant.id)?.score ?? 50),
      score: snapshot.transactions.find((transaction) => transaction.merchantId === merchant.id)?.score ?? 50,
    },
    alert: {
      id: alert.id,
      title: buildTitle(alert),
      cluster: cluster?.label ?? "direct merchant pressure",
      time: relativeFrom(snapshot.generatedAt, alert.createdAt),
    },
    recentActions: [
      { label: "Hold rule suggested", sub: defense.summary.recommendation, color: "text-purple-400" },
      { label: "Measured precision", sub: formatPercent((policy?.precision ?? defense.evaluation.precision) * 100), color: "text-emerald-400" },
      { label: "Recent audit", sub: auditEvents[0]?.note ?? defense.summary.title, color: "text-amber-400" },
    ],
  };
}

function buildDeliberations(
  defense: DefenseLabSnapshot,
  approvals: AgentApprovalRequestRecord[],
): {
  deliberations: ConsoleData["simulator"]["deliberations"];
  activity: ConsoleData["simulator"]["activity"];
} {
  const deliberations = defense.events.map((event) => {
    const frame = defense.frames.find((entry) => entry.tick === event.tick);
    const actions = frame?.agentActions ?? [];
    const approval = approvals.find(
      (entry) => entry.tick === event.tick && entry.targetId === event.transactionId,
    );
    const fallbackAction =
      event.outcome === "hold"
        ? "Hold this payment and pause the merchant lane for 30 minutes"
        : event.outcome === "step-up"
          ? "Require device verification and send the payment to manual review"
          : "Keep the payment under watch until one more linked signal appears";
    const averageConfidence =
      actions.reduce((total, action) => total + action.confidence, 0) /
      Math.max(actions.length, 1);
    const openingMessage = (role: string, reasoning: string, action: string) => {
      if (role === "signal_scout") {
        return `I found the first warning signs on ${event.transactionId}. ${reasoning} Merchant Guard, can you check whether ${event.merchantName} is seeing the same pattern?`;
      }
      if (role === "merchant_guard") {
        return `Yes, I checked the business account and it matches. ${reasoning} Policy Guard, does that give us enough reason to act?`;
      }
      if (role === "policy_guard") {
        return `It does. My checks point the same way: ${reasoning} I recommend we ${action.toLowerCase()}. Queue Ops, can the review team handle it now?`;
      }
      return `Yes, the team has room for it. ${reasoning} I can carry out that response without slowing the rest of the payment queue.`;
    };
    const followUpMessage = (role: string, action: string) => {
      if (role === "signal_scout") {
        return `I checked the linked attempts once more. The warning signs are still connected, so my vote is to ${action.toLowerCase()}.`;
      }
      if (role === "merchant_guard") {
        return `Agreed from the merchant side. This protects ${event.merchantName} while keeping the response limited to the affected activity.`;
      }
      if (role === "policy_guard") {
        return "I agree too. The evidence supports this response, and it stays within our safety rules.";
      }
      return "That makes four of us in agreement. I have prepared the decision for the admin to approve or decline.";
    };
    const kindForRole = (role: string) => {
      if (role === "signal_scout") return "observation" as const;
      if (role === "merchant_guard") return "assessment" as const;
      if (role === "policy_guard") return "recommendation" as const;
      return "operations" as const;
    };

    return {
      id: `deliberation_${event.id}`,
      tick: event.tick,
      title: event.title,
      summary: event.summary,
      merchantName: event.merchantName,
      transactionId: event.transactionId,
      amount: event.amount,
      riskScore: event.score,
      outcome: event.outcome,
      messages: [
        ...actions.map((action, index) => ({
          id: `chat_${event.id}_${action.agentId}_check`,
          agentName: action.agentName,
          role: formatAgentRole(action.role),
          text: openingMessage(action.role, action.reasoning, action.action),
          time: formatClock(
            new Date(Date.parse(defense.generatedAt) + event.tick * 45_000 + index * 8_000).toISOString(),
          ),
          kind: kindForRole(action.role),
        })),
        ...actions.map((action, index) => ({
          id: `chat_${event.id}_${action.agentId}_vote`,
          agentName: action.agentName,
          role: formatAgentRole(action.role),
          text: followUpMessage(action.role, action.action),
          time: formatClock(
            new Date(Date.parse(defense.generatedAt) + event.tick * 45_000 + 38_000 + index * 6_000).toISOString(),
          ),
          kind: kindForRole(action.role),
        })),
      ],
      consensus: {
        action: approval?.action ?? fallbackAction,
        rationale: `The team connected ${event.merchantName}, ${event.transactionId}, and the live queue impact. ${event.action}`,
        confidence: formatPercent(averageConfidence * 100),
        votes: actions.length,
        status: approval?.status ?? "informational",
        approvalId: approval?.id ?? null,
      },
    } satisfies ConsoleData["simulator"]["deliberations"][number];
  });

  const activity = deliberations.flatMap((deliberation) => {
    const messages: ConsoleData["simulator"]["activity"] = deliberation.messages.map((message) => ({
      id: `activity_${message.id}`,
      tick: deliberation.tick,
      type: "message",
      actor: message.agentName,
      target: "team",
      message: message.text,
      time: message.time,
    }));
    const decision: ConsoleData["simulator"]["activity"][number] = {
      id: `activity_consensus_${deliberation.id}`,
      tick: deliberation.tick,
      type: deliberation.consensus.status === "pending" ? "decision" : "approval",
      actor: "Sentinel Team",
      target: "platform admin",
      message: `${deliberation.consensus.action}. ${deliberation.consensus.votes}/${defense.agentRoster.length} agents agreed.`,
      time: deliberation.messages.at(-1)?.time ?? formatClock(defense.generatedAt),
    };

    return [...messages, decision];
  });

  return { deliberations, activity };
}

function buildSimulator(
  snapshot: DashboardSnapshot,
  defense: DefenseLabSnapshot,
  policy?: PolicyArtifactRecord,
  baselinePolicy?: PolicyArtifactRecord,
  simulatorRun?: SimulatorRunRecord,
  agentMemories: AgentMemoryRecord[] = [],
  agentApprovalRequests: AgentApprovalRequestRecord[] = [],
  agentTelemetry: AgentTelemetryRecord[] = [],
) {
  const { deliberations, activity } = buildDeliberations(defense, agentApprovalRequests);
  const sourceMap = new Map(snapshot.transactions.map((transaction) => [transaction.id, transaction]));
  const laneCounters: Record<SimulatorLane, number> = {
    merchant: 0,
    cluster: 0,
    payment: 0,
    customer: 0,
    control: 0,
  };

  const lanePosition = (type: ConsoleNodeType, index: number) => {
    if (type === "merchant") {
      return { x: 400, y: 300 + index * 260 };
    }
    if (type === "cluster") {
      return { x: 850, y: 250 + index * 250 };
    }
    if (type === "payment") {
      return { x: 1260 + (index % 2) * 300, y: 180 + Math.floor(index / 2) * 248 };
    }
    if (type === "customer") {
      return { x: 1910, y: 360 + index * 260 };
    }
    return { x: 1620, y: 1020 + index * 250 };
  };

  const compactMeta = (value: Record<string, string | undefined>) =>
    Object.fromEntries(
      Object.entries(value).filter(([, entry]) => typeof entry === "string" && entry.length > 0),
    ) as Record<string, string>;

  const nodes: ConsoleSimNode[] = defense.nodes.map((node) => {
    const relatedTransaction = node.id.startsWith("payment_")
      ? sourceMap.get(node.id.replace("payment_", ""))
      : undefined;
    const relatedEvent = relatedTransaction
      ? defense.events.find((event) => event.transactionId === relatedTransaction.id)
      : undefined;
    const risk = toNodeRisk(node.risk, node.status);
    const type = toNodeType(node.type);
    const lane: SimulatorLane =
      type === "queue" || type === "verifier"
        ? "control"
        : type === "merchant" || type === "cluster" || type === "payment" || type === "customer"
          ? type
          : "control";
    const laneIndex = laneCounters[lane]++;
    const position = lanePosition(type, laneIndex);

    const meta =
      type === "payment"
        ? compactMeta({
            "Payment ID": relatedTransaction?.id ?? node.label,
            Business: relatedTransaction?.merchantName ?? node.meta[0] ?? "",
            Amount: relatedTransaction ? money(relatedTransaction.amount) : node.meta[1] ?? "",
            Method: relatedTransaction?.method ?? "Payment",
            Outcome: toTxStatus(
              relatedTransaction ?? snapshot.transactions[0],
              defense.config.autoHoldThreshold,
            ).toUpperCase(),
            "Risk score": `${node.risk}/100`,
            "Chance of fraud": relatedEvent ? formatPercent(relatedEvent.probability * 100) : undefined,
            "Decision confidence": relatedEvent ? formatPercent(relatedEvent.confidence * 100) : undefined,
            "Main reason": relatedEvent?.topDrivers[0]
              ? `${relatedEvent.topDrivers[0].label}: ${relatedEvent.topDrivers[0].value}`
              : undefined,
          })
        : type === "merchant"
          ? compactMeta({
              "Primary flow": node.meta[0] ?? "Risk watch",
              Exposure: node.meta[1] ?? "",
              Status: node.status.toUpperCase(),
            })
          : type === "cluster"
            ? compactMeta({
                Pattern: node.label,
                "Linked payments": node.meta[0] ?? "",
                "Merchant spread": node.meta[1] ?? "",
                Status: node.status.toUpperCase(),
              })
            : type === "customer"
              ? compactMeta({
                  Identity: node.label,
                  History: node.meta[0] ?? "",
                  Velocity: node.meta[1] ?? "",
                  Status: node.status.toUpperCase(),
                })
              : compactMeta({
                  Control: node.label,
                  Action: node.meta[0] ?? "",
                  Status: node.status.toUpperCase(),
                });

    return {
      id: node.id,
      type,
      label: node.label,
      sublabel:
        type === "cluster"
          ? node.meta[0]
          : type === "payment"
            ? relatedTransaction?.merchantName
            : node.meta[0],
      x: position.x,
      y: position.y,
      risk,
      r:
        type === "cluster"
          ? 58
          : type === "merchant"
            ? 46
            : type === "verifier" || type === "queue"
              ? 36
              : type === "customer"
                ? 28
                : 32,
      meta,
    };
  });

  const edges: ConsoleSimEdge[] = defense.edges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
    type: edgeTypeFromSnapshot(edge.status, edge.label),
  }));

  const frames: ConsoleSimFrame[] = defense.frames.map((frame) => ({
    tick: frame.tick,
    headline: frame.headline,
    subline: frame.subline,
    activeNodeIds: frame.activeNodeIds,
    activeEdgeIds: frame.activeEdgeIds,
    metricCards: frame.metrics.slice(0, 4).map((metric) => ({
      label: metric.label,
      value: metric.value,
      tone: metric.tone,
    })),
    agentActions: frame.agentActions.map((action) => ({
      id: action.id,
      agentName: action.agentName,
      role: action.role.replaceAll("_", " "),
      action: action.action,
      reasoning: action.reasoning,
      confidence: action.confidence,
    })),
    feed: frame.feed.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      action: item.action,
      amount: item.amount,
      score: item.score,
      outcome: item.outcome,
      probability: formatPercent(item.probability * 100),
      confidence: formatPercent(item.confidence * 100),
      agentLine:
        item.agentActions.length > 0
          ? `${item.agentActions.map((action) => action.agentName).join(" · ")} acted on this tick`
          : "No agent intervention on this tick",
    })),
  }));

  const comparison: ConsoleData["simulator"]["comparison"] =
    policy?.challenger && baselinePolicy
      ? {
          baselineLabel: `Baseline · ${baselinePolicy.config.threshold}/${baselinePolicy.config.autoHoldThreshold}`,
          challengerLabel: `Active replay · ${defense.config.threshold}/${defense.config.autoHoldThreshold}`,
          recommendation: policy.challenger.recommendation,
          metrics: [
            {
              label: "Accuracy on blocked payments",
              baseline: formatPercent(baselinePolicy.precision * 100),
              challenger: formatPercent(policy.precision * 100),
              delta: `${policy.challenger.precisionDelta >= 0 ? "+" : ""}${formatPercent(policy.challenger.precisionDelta * 100)}`,
              tone:
                policy.challenger.precisionDelta >= 0.02
                  ? "good"
                  : policy.challenger.precisionDelta >= -0.01
                    ? "warn"
                    : "bad",
            },
            {
              label: "Fraud found",
              baseline: formatPercent(baselinePolicy.recall * 100),
              challenger: formatPercent(policy.recall * 100),
              delta: `${policy.challenger.recallDelta >= 0 ? "+" : ""}${formatPercent(policy.challenger.recallDelta * 100)}`,
              tone:
                policy.challenger.recallDelta >= 0.02
                  ? "good"
                  : policy.challenger.recallDelta >= -0.01
                    ? "warn"
                    : "bad",
            },
            {
              label: "Cost of reviewing safe payments",
              baseline: money(Math.round(baselinePolicy.falsePositiveCost)),
              challenger: money(Math.round(policy.falsePositiveCost)),
              delta: `${policy.challenger.falsePositiveCostDelta >= 0 ? "+" : ""}${money(Math.round(policy.challenger.falsePositiveCostDelta))}`,
              tone:
                policy.challenger.falsePositiveCostDelta < 0
                  ? "good"
                  : policy.challenger.falsePositiveCostDelta <= 15000
                    ? "warn"
                    : "bad",
            },
            {
              label: "Payments needing review",
              baseline: String(baselinePolicy.reviewLoad),
              challenger: String(policy.reviewLoad),
              delta: `${policy.challenger.reviewLoadDelta >= 0 ? "+" : ""}${policy.challenger.reviewLoadDelta}`,
              tone:
                policy.challenger.reviewLoadDelta <= 0
                  ? "good"
                  : policy.challenger.reviewLoadDelta <= 1
                    ? "warn"
                    : "bad",
            },
          ],
        }
      : undefined;

  const sessionTimeline = [
    ...defense.agentActions.map((action) => ({
      id: action.id,
      tick: action.tick,
      title: `${action.targetLabel} · ${action.action}`,
      effect: action.reasoning,
      actor: action.agentName,
      time: `${Math.round(action.confidence * 100)}% confidence`,
      source: "agent" as const,
    })),
    ...(simulatorRun?.interventions ?? []).map((intervention) => ({
      id: intervention.id,
      tick: intervention.tick,
      title: `${intervention.targetLabel} · ${intervention.action}`,
      effect: intervention.effect,
      actor: intervention.actor,
      time: formatClock(intervention.createdAt),
      source: "analyst" as const,
    })),
  ] satisfies ConsoleData["simulator"]["sessionTimeline"];

  return {
    title: "Real-time fraud spike simulator",
    statsLabel: defense.clusters[0]?.label ?? "Live review",
    replayCohort: simulatorRun?.replayCohort ?? "linked_attacks",
    config: defense.config,
    comparison,
    sessionTimeline,
    agentRoster: defense.agentRoster.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: formatAgentRole(agent.role),
      mission: agent.mission,
      status: defense.agentActions.some((action) => action.agentId === agent.id) ? "Working now" : "Watching",
    })),
    model: {
      label: defense.model.label,
      precision: formatPercent(defense.model.precision * 100),
      recall: formatPercent(defense.model.recall * 100),
      accuracy: formatPercent(defense.model.accuracy * 100),
      threshold: formatPercent(defense.model.threshold * 100),
      samples: `${defense.model.trainingSamples} train · ${defense.model.holdoutSamples} holdout`,
      status: defense.model.status,
      summary: defense.model.summary,
    },
    agentMemories: agentMemories.slice(0, 8).map((memory) => ({
      id: memory.id,
      agentName: memory.agentName,
      title: memory.title,
      summary: memory.summary,
      confidence: formatPercent(memory.confidence * 100),
      scopeLabel: memory.scopeLabel,
      tags: memory.tags,
    })),
    approvals: agentApprovalRequests
      .slice()
      .sort((left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime())
      .slice(0, 8)
      .map((approval) => ({
        id: approval.id,
        tick: approval.tick,
        agentName: approval.agentName,
        targetLabel: approval.targetLabel,
        action: approval.action,
        rationale: approval.rationale,
        status: approval.status,
        requestedAt: formatClock(approval.requestedAt),
        resolutionNote: approval.resolutionNote ?? null,
      })),
    telemetry: agentTelemetry.slice(0, 8).map((entry) => ({
      id: entry.id,
      agentName: entry.agentName,
      role: formatAgentRole(entry.role),
      decisions: entry.decisions,
      avgConfidence: formatPercent(entry.avgConfidence * 100),
      queueDelta: entry.queueDelta,
      estimatedLossPrevented: money(Math.round(entry.estimatedLossPrevented)),
      createdAt: formatClock(entry.createdAt),
    })),
    deliberations,
    activity,
    activeRunLabel: `Review level ${defense.config.threshold} - automatic hold level ${defense.config.autoHoldThreshold}`,
    nodes,
    edges,
    frames,
    summaryTitle: defense.summary.title,
    summarySubtitle: defense.summary.subtitle,
    liveStats: [
      { label: "Events", value: String(defense.events.length), color: "text-foreground" },
      { label: "Loss avoided", value: money(Math.round(defense.evaluation.lossAvoided)), color: "text-red-400" },
      { label: "Agents", value: `${defense.agentRoster.length} live`, color: "text-amber-400" },
      { label: "Correct risk decisions", value: formatPercent(defense.model.precision * 100), color: "text-purple-400" },
    ],
  };
}

export function buildConsoleData(input: {
  snapshot: DashboardSnapshot;
  defense: DefenseLabSnapshot;
  copilotProviderLabel: string;
  cases?: ReviewCaseRecord[];
  caseComments?: CaseCommentRecord[];
  merchantOverrides?: MerchantOverrideRecord[];
  graph?: GraphSnapshotRecord;
  policy?: PolicyArtifactRecord;
  baselinePolicy?: PolicyArtifactRecord;
  auditEvents?: AuditEventRecord[];
  simulatorRun?: SimulatorRunRecord;
  agentMemories?: AgentMemoryRecord[];
  agentApprovalRequests?: AgentApprovalRequestRecord[];
  agentTelemetry?: AgentTelemetryRecord[];
}): ConsoleData {
  const {
    snapshot,
    defense,
    copilotProviderLabel,
    cases,
    caseComments,
    merchantOverrides,
    graph,
    policy,
    baselinePolicy,
    auditEvents,
    simulatorRun,
    agentMemories,
    agentApprovalRequests,
    agentTelemetry,
  } = input;

  return {
    generatedAt: snapshot.generatedAt,
    copilotProviderLabel,
    queueData: buildQueueData(snapshot),
    overview: buildOverview(snapshot, defense, cases, policy),
    clusters: buildClustersFromGraph(snapshot, graph),
    alerts: buildAlerts(snapshot, cases, auditEvents, caseComments),
    merchants: buildMerchants(snapshot, defense.config.autoHoldThreshold, merchantOverrides),
    transactions: buildTransactions(snapshot, defense.config.autoHoldThreshold),
    suggestions: buildSuggestions(snapshot),
    initialMessages: buildInitialMessages(snapshot, defense),
    copilotContext: buildCopilotContext(snapshot, defense, policy, auditEvents),
    simulator: buildSimulator(
      snapshot,
      defense,
      policy,
      baselinePolicy,
      simulatorRun,
      agentMemories,
      agentApprovalRequests,
      agentTelemetry,
    ),
  };
}
