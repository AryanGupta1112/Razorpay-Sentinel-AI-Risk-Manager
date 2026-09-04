import type { AlertSeverity, DefenseLabConfig, ReplayCohort } from "@/types/risk";

export type ReviewCaseStatus =
  | "open"
  | "investigating"
  | "held"
  | "escalated"
  | "dismissed";

export type ReviewCaseRecord = {
  id: string;
  alertId: string;
  transactionId: string;
  merchantId: string;
  merchantName: string;
  severity: AlertSeverity;
  title: string;
  type: string;
  score: number;
  exposure: number;
  reason: string;
  recommendation: string;
  status: ReviewCaseStatus;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  clusterId: string | null;
};

export type CaseCommentRecord = {
  id: string;
  caseId: string;
  author: string;
  content: string;
  createdAt: string;
};

type AuditEventType =
  | "case_created"
  | "case_held"
  | "case_investigating"
  | "case_escalated"
  | "case_dismissed"
  | "policy_evaluated"
  | "simulator_run_saved"
  | "graph_refreshed";

export type AuditEventRecord = {
  id: string;
  caseId: string | null;
  type: AuditEventType;
  actor: string;
  note: string;
  createdAt: string;
  metadata?: Record<string, string>;
};

export type CalibrationBin = {
  label: string;
  minScore: number;
  maxScore: number;
  count: number;
  fraudLikeCount: number;
  averageScore: number;
  precision: number;
};

export type PolicyArtifactRecord = {
  id: string;
  generatedAt: string;
  config: DefenseLabConfig;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  falsePositiveCost: number;
  lossAvoided: number;
  reviewLoad: number;
  recommendation: string;
  measurableOutcome: string;
  calibration: CalibrationBin[];
  challenger?: {
    baselinePolicyId: string;
    precisionDelta: number;
    recallDelta: number;
    falsePositiveCostDelta: number;
    reviewLoadDelta: number;
    recommendation: string;
  };
  drift?: {
    status: "stable" | "watch" | "elevated";
    averageScoreShift: number;
    highRiskRateShift: number;
    merchantConcentrationShift: number;
    queuePressureShift: number;
    summary: string;
  };
};

export type MerchantOverrideRecord = {
  merchantId: string;
  merchantName: string;
  strategy: "strict" | "balanced" | "lenient";
  thresholdOffset: number;
  autoHoldOffset: number;
  reason: string;
  updatedAt: string;
};

export type GraphNodeRecord = {
  id: string;
  kind: "merchant" | "payment" | "customer" | "signal" | "queue";
  label: string;
  risk: number;
};

export type GraphEdgeRecord = {
  id: string;
  source: string;
  target: string;
  relation: string;
  strength: number;
};

export type GraphClusterRecord = {
  id: string;
  label: string;
  summary: string;
  severity: AlertSeverity;
  averageScore: number;
  exposure: number;
  merchantIds: string[];
  transactionIds: string[];
  customerIds: string[];
  sharedSignals: string[];
  queuePressure: number;
};

export type GraphSnapshotRecord = {
  id: string;
  generatedAt: string;
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  clusters: GraphClusterRecord[];
};

export type SimulatorInterventionRecord = {
  id: string;
  tick: number;
  actor: string;
  targetType: "merchant" | "cluster" | "payment" | "policy";
  targetId: string;
  targetLabel: string;
  action: string;
  effect: string;
  createdAt: string;
};

export type SimulatorRunRecord = {
  id: string;
  createdAt: string;
  config: DefenseLabConfig;
  replayCohort: ReplayCohort;
  summaryTitle: string;
  summarySubtitle: string;
  reviewLoad: number;
  precision: number;
  recall: number;
  falsePositiveCost: number;
  lossAvoided: number;
  clusterIds: string[];
  interventions: SimulatorInterventionRecord[];
};

export type AgentMemoryRecord = {
  id: string;
  agentId: string;
  agentName: string;
  scopeType: "merchant" | "cluster" | "payment" | "policy" | "queue";
  scopeId: string;
  scopeLabel: string;
  title: string;
  summary: string;
  confidence: number;
  tags: string[];
  createdAt: string;
};

export type AgentApprovalRequestRecord = {
  id: string;
  tick: number;
  agentId: string;
  agentName: string;
  targetType: "merchant" | "cluster" | "payment" | "policy" | "queue";
  targetId: string;
  targetLabel: string;
  action: string;
  rationale: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
};

export type AgentTelemetryRecord = {
  id: string;
  agentId: string;
  agentName: string;
  role: string;
  tick: number;
  decisions: number;
  avgConfidence: number;
  queueDelta: number;
  estimatedLossPrevented: number;
  createdAt: string;
};

export type OpsStore = {
  version: 2;
  cases: ReviewCaseRecord[];
  caseComments: CaseCommentRecord[];
  auditEvents: AuditEventRecord[];
  policyArtifacts: PolicyArtifactRecord[];
  graphSnapshots: GraphSnapshotRecord[];
  simulatorRuns: SimulatorRunRecord[];
  merchantOverrides: MerchantOverrideRecord[];
  agentMemories: AgentMemoryRecord[];
  agentApprovalRequests: AgentApprovalRequestRecord[];
  agentTelemetry: AgentTelemetryRecord[];
};
