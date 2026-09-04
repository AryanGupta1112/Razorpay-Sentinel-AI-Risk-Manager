export type PaymentMethod = "UPI" | "Card" | "Netbanking" | "Wallet";

export type Merchant = {
  id: string;
  name: string;
  category: string;
  owner: string;
  region: string;
  kycTier: "Full" | "Provisional";
  monthlyVolume: number;
  chargebackRate: number;
  disputeCount: number;
  failureRate: number;
  refundRate: number;
  trustScore: number;
  settlementDelayHours: number;
};

export type Transaction = {
  id: string;
  merchantId: string;
  customer: string;
  amount: number;
  currency: "INR";
  method: PaymentMethod;
  status: "captured" | "failed" | "pending" | "refunded";
  createdAt: string;
  deviceAgeDays: number;
  geoDistanceKm: number;
  attempts: number;
  ipVelocity: number;
  nightTraffic: boolean;
  previousChargebacks: number;
};

export type AlertSeverity = "critical" | "high" | "medium";

type RiskTrigger = {
  code: string;
  label: string;
  weight: number;
};

export type RiskTransaction = Transaction & {
  merchantName: string;
  score: number;
  severity: AlertSeverity;
  triggers: RiskTrigger[];
  explanation: string;
  recommendation: string;
};

export type MerchantInsight = Merchant & {
  healthScore: number;
  reviewStatus: "monitor" | "review" | "watch" | "escalate";
  flaggedTransactions: number;
  capturedVolume: number;
  dominantRisk: string;
};

export type OverviewMetric = {
  label: string;
  value: string;
  delta: string;
  tone: "neutral" | "good" | "warn" | "bad";
};

export type TrendPoint = {
  date: string;
  riskVolume: number;
  failedPayments: number;
  disputes: number;
};

export type MethodBreakdown = {
  method: PaymentMethod;
  count: number;
  flagged: number;
};

export type AlertCase = {
  id: string;
  merchantName: string;
  transactionId: string;
  severity: AlertSeverity;
  action: string;
  summary: string;
};

export type DashboardSnapshot = {
  generatedAt: string;
  overview: OverviewMetric[];
  trends: TrendPoint[];
  methodBreakdown: MethodBreakdown[];
  transactions: RiskTransaction[];
  alerts: RiskTransaction[];
  merchants: MerchantInsight[];
  cases: AlertCase[];
  narrative: string;
};

export type DefenseLabConfig = {
  threshold: number;
  autoHoldThreshold: number;
  stepUpVerification: boolean;
  velocityClamp: boolean;
  analystCapacity: number;
};

export type ReplayCohort =
  | "linked_attacks"
  | "merchant_spike"
  | "chargeback_ring"
  | "weekend_burst";

type DefenseLabNodeType =
  | "merchant"
  | "cluster"
  | "payment"
  | "customer"
  | "verifier"
  | "queue";

export type DefenseLabNode = {
  id: string;
  label: string;
  type: DefenseLabNodeType;
  x: number;
  y: number;
  risk: number;
  status: "stable" | "watch" | "active" | "blocked";
  meta: string[];
};

export type DefenseLabEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
  status: "stable" | "active" | "blocked";
};

export type DefenseLabEvent = {
  id: string;
  tick: number;
  transactionId: string;
  merchantName: string;
  title: string;
  summary: string;
  action: string;
  amount: string;
  score: number;
  outcome: "observe" | "step-up" | "hold";
  probability: number;
  confidence: number;
  topDrivers: DefenseMlDriver[];
  agentActions: DefenseAgentAction[];
};

export type DefenseLabMetric = {
  id: string;
  label: string;
  value: string;
  delta: string;
  tone: "neutral" | "good" | "warn" | "bad";
};

export type DefenseLabFrame = {
  tick: number;
  headline: string;
  subline: string;
  activeNodeIds: string[];
  activeEdgeIds: string[];
  metrics: DefenseLabMetric[];
  feed: DefenseLabEvent[];
  agentActions: DefenseAgentAction[];
};

export type DefenseLabCluster = {
  id: string;
  label: string;
  description: string;
  transactionIds: string[];
  merchantIds: string[];
  pressure: number;
};

export type DefenseMlDriver = {
  feature: string;
  label: string;
  value: string;
  impact: number;
  direction: "up" | "down";
};

export type DefenseMlInsight = {
  probability: number;
  confidence: number;
  verdict: "fraud_likely" | "review" | "safe";
  topDrivers: DefenseMlDriver[];
};

export type DefenseMlModelSummary = {
  label: string;
  trainingSamples: number;
  holdoutSamples: number;
  threshold: number;
  precision: number;
  recall: number;
  accuracy: number;
  status: "stable" | "watch" | "elevated";
  summary: string;
};

export type DefenseAgentRole =
  | "signal_scout"
  | "merchant_guard"
  | "policy_guard"
  | "queue_coordinator";

export type DefenseAgent = {
  id: string;
  name: string;
  role: DefenseAgentRole;
  mission: string;
  style: "critical" | "watch" | "control" | "ops";
  llmProvider?: string;
  llmModel?: string;
  llmLabel?: string;
};

export type DefenseAgentAction = {
  id: string;
  tick: number;
  agentId: string;
  agentName: string;
  role: DefenseAgentRole;
  targetType: "merchant" | "cluster" | "payment" | "queue" | "policy";
  targetId: string;
  targetLabel: string;
  action: string;
  reasoning: string;
  confidence: number;
};

export type DefenseLabSnapshot = {
  generatedAt: string;
  config: DefenseLabConfig;
  nodes: DefenseLabNode[];
  edges: DefenseLabEdge[];
  frames: DefenseLabFrame[];
  events: DefenseLabEvent[];
  clusters: DefenseLabCluster[];
  agentRoster: DefenseAgent[];
  agentActions: DefenseAgentAction[];
  model: DefenseMlModelSummary;
  evaluation: {
    reviewedTransactions: number;
    precision: number;
    recall: number;
    falsePositiveRate: number;
    blockedValue: number;
    falsePositiveCost: number;
    lossAvoided: number;
  };
  summary: {
    title: string;
    subtitle: string;
    recommendation: string;
    measurableOutcome: string;
  };
};
