import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { buildDefenseLabSnapshot, DEFAULT_CONFIG } from "@/lib/simulation-engine";
import { getDashboardSnapshot } from "@/lib/risk-engine";
import { hasDatabaseUrl, queryDb, withDatabaseTransaction } from "@/lib/server/database";
import { buildGraphSnapshot } from "@/lib/server/graph-intelligence";
import { readOperationalData } from "@/lib/server/operational-read";
import { getRuntimeStoreDirectory } from "@/lib/server/runtime-storage";
import type {
  AgentApprovalRequestRecord,
  AgentMemoryRecord,
  AgentTelemetryRecord,
  AuditEventRecord,
  CalibrationBin,
  CaseCommentRecord,
  GraphSnapshotRecord,
  MerchantOverrideRecord,
  OpsStore,
  PolicyArtifactRecord,
  ReviewCaseRecord,
  SimulatorInterventionRecord,
  SimulatorRunRecord,
} from "@/types/ops";
import type { DefenseLabConfig, ReplayCohort, RiskTransaction } from "@/types/risk";

const STORE_DIR = getRuntimeStoreDirectory();
const STORE_PATH = path.join(STORE_DIR, "ops-store.json");
const TABLE_PREFIX = "sentinel_ops";

let schemaPromise: Promise<void> | null = null;
let lastKnownPostgresStore: OpsStore | null = null;

function alertDisplayId(transactionId: string) {
  return `ALT-${transactionId.replace(/^pay_/i, "").toUpperCase()}`;
}

function caseTitle(transaction: RiskTransaction) {
  const primary = transaction.triggers[0]?.label ?? "Risk signal";

  if (primary === "High-ticket payment") return "High-value payment collision";
  if (primary === "Fresh device fingerprint") return "Fresh-device burst detected";
  if (primary === "Large geo deviation") return "Geo-deviation ring detected";
  if (primary === "Multiple retry attempts") return "Retry pressure threshold breached";
  return `${primary} escalation`;
}

function clusterIdFor(transaction: RiskTransaction) {
  const primary = transaction.triggers[0]?.code;
  return primary ? `graph_${primary}` : null;
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

function createCalibration(transactions: RiskTransaction[]): CalibrationBin[] {
  const ranges = [
    { label: "0-59", minScore: 0, maxScore: 59 },
    { label: "60-69", minScore: 60, maxScore: 69 },
    { label: "70-79", minScore: 70, maxScore: 79 },
    { label: "80-89", minScore: 80, maxScore: 89 },
    { label: "90-100", minScore: 90, maxScore: 100 },
  ];

  return ranges.map((range) => {
    const members = transactions.filter(
      (transaction) => transaction.score >= range.minScore && transaction.score <= range.maxScore,
    );
    const fraudLikeCount = members.filter(isFraudLike).length;
    const averageScore =
      members.length === 0
        ? (range.minScore + range.maxScore) / 2
        : members.reduce((total, transaction) => total + transaction.score, 0) / members.length;

    return {
      ...range,
      count: members.length,
      fraudLikeCount,
      averageScore: Math.round(averageScore * 10) / 10,
      precision: members.length === 0 ? 0 : fraudLikeCount / members.length,
    };
  });
}

function buildDriftSummary(transactions: RiskTransaction[]) {
  const averageScore =
    transactions.reduce((total, transaction) => total + transaction.score, 0) / Math.max(transactions.length, 1);
  const highRiskRate =
    transactions.filter((transaction) => transaction.score >= 68).length / Math.max(transactions.length, 1);
  const merchantIds = [...new Set(transactions.map((transaction) => transaction.merchantId))];
  const highRiskByMerchant = transactions
    .filter((transaction) => transaction.score >= 68)
    .reduce((accumulator, transaction) => {
      accumulator.set(transaction.merchantId, (accumulator.get(transaction.merchantId) ?? 0) + 1);
      return accumulator;
    }, new Map<string, number>());
  const topConcentration =
    merchantIds.length === 0 ? 0 : Math.max(0, ...highRiskByMerchant.values()) / merchantIds.length;
  const queuePressureShift = transactions.filter((transaction) => transaction.score >= 68).length - 4;
  const averageScoreShift = Math.round((averageScore - 72) * 10) / 10;
  const highRiskRateShift = Math.round((highRiskRate * 100 - 55) * 10) / 10;
  const merchantConcentrationShift = Math.round((topConcentration - 1.5) * 10) / 10;
  const elevated =
    averageScoreShift >= 8 || highRiskRateShift >= 12 || merchantConcentrationShift >= 1 || queuePressureShift >= 3;
  const watch =
    averageScoreShift >= 3 || highRiskRateShift >= 6 || merchantConcentrationShift >= 0.5 || queuePressureShift >= 1;

  return {
    status: elevated ? ("elevated" as const) : watch ? ("watch" as const) : ("stable" as const),
    averageScoreShift,
    highRiskRateShift,
    merchantConcentrationShift,
    queuePressureShift,
    summary: elevated
      ? "Score drift and merchant concentration are climbing fast enough to justify a tighter pilot."
      : watch
        ? "Traffic is drifting upward. Keep challenger policy ready and monitor queue concentration."
        : "Traffic shape is stable against the current replay baseline.",
  };
}

function buildChallenger(
  baseline: PolicyArtifactRecord | null,
  nextArtifact: PolicyArtifactRecord,
): PolicyArtifactRecord["challenger"] | undefined {
  if (!baseline) {
    return undefined;
  }

  const precisionDelta = nextArtifact.precision - baseline.precision;
  const recallDelta = nextArtifact.recall - baseline.recall;
  const falsePositiveCostDelta = nextArtifact.falsePositiveCost - baseline.falsePositiveCost;
  const reviewLoadDelta = nextArtifact.reviewLoad - baseline.reviewLoad;

  return {
    baselinePolicyId: baseline.id,
    precisionDelta,
    recallDelta,
    falsePositiveCostDelta,
    reviewLoadDelta,
    recommendation:
      precisionDelta >= 0.03 && falsePositiveCostDelta <= 0
        ? "Promote the challenger for a scoped pilot because it improves precision without adding review cost."
        : recallDelta >= 0.04 && reviewLoadDelta <= 1
          ? "Test the challenger on hyperlocal and travel merchants to improve catch rate."
          : "Keep the baseline policy active and use the challenger as an analyst-side benchmark only.",
  };
}

function buildPolicyArtifact(
  config: DefenseLabConfig,
  baseline: PolicyArtifactRecord | null = null,
  replayCohort: ReplayCohort = "linked_attacks",
  merchantOverrides: MerchantOverrideRecord[] = [],
): PolicyArtifactRecord {
  const snapshot = getDashboardSnapshot();
  const defense = buildDefenseLabSnapshot({
    ...config,
    replayCohort,
    merchantOverrides,
  });
  const drift = buildDriftSummary(snapshot.transactions);

  const artifact: PolicyArtifactRecord = {
    id: `policy_${replayCohort}_${config.threshold}_${config.autoHoldThreshold}_${config.analystCapacity}`,
    generatedAt: defense.generatedAt,
    config: defense.config,
    precision: defense.evaluation.precision,
    recall: defense.evaluation.recall,
    falsePositiveRate: defense.evaluation.falsePositiveRate,
    falsePositiveCost: defense.evaluation.falsePositiveCost,
    lossAvoided: defense.evaluation.lossAvoided,
    reviewLoad: defense.evaluation.reviewedTransactions,
    recommendation: defense.summary.recommendation,
    measurableOutcome: defense.summary.measurableOutcome,
    calibration: createCalibration(snapshot.transactions),
    drift,
  };

  artifact.challenger = buildChallenger(baseline, artifact);

  return artifact;
}

function buildSimulatorRun(
  config: DefenseLabConfig,
  replayCohort: ReplayCohort = "linked_attacks",
  merchantOverrides: MerchantOverrideRecord[] = [],
  interventions: SimulatorInterventionRecord[] = [],
): SimulatorRunRecord {
  const defense = buildDefenseLabSnapshot({
    ...config,
    replayCohort,
    merchantOverrides,
  });

  return {
    id: `sim_${replayCohort}_${config.threshold}_${config.autoHoldThreshold}_${config.analystCapacity}`,
    createdAt: defense.generatedAt,
    config: defense.config,
    replayCohort,
    summaryTitle: defense.summary.title,
    summarySubtitle: defense.summary.subtitle,
    reviewLoad: defense.evaluation.reviewedTransactions,
    precision: defense.evaluation.precision,
    recall: defense.evaluation.recall,
    falsePositiveCost: defense.evaluation.falsePositiveCost,
    lossAvoided: defense.evaluation.lossAvoided,
    clusterIds: defense.clusters.map((cluster) => cluster.id),
    interventions,
  };
}

function buildSeedCases(): ReviewCaseRecord[] {
  const snapshot = getDashboardSnapshot();

  return snapshot.alerts.map((alert, index) => ({
    id: `case_${alert.id.toLowerCase()}`,
    alertId: alertDisplayId(alert.id),
    transactionId: alert.id,
    merchantId: alert.merchantId,
    merchantName: alert.merchantName,
    severity: alert.severity,
    title: caseTitle(alert),
    type: alert.triggers[0]?.code ?? "risk_signal",
    score: alert.score,
    exposure: alert.amount,
    reason: alert.explanation,
    recommendation: alert.recommendation,
    status: alert.score >= 92 ? "open" : alert.score >= 80 ? "investigating" : "open",
    assignee: index < 2 ? "Fraud Ops Desk" : "Risk Queue",
    createdAt: snapshot.generatedAt,
    updatedAt: snapshot.generatedAt,
    clusterId: clusterIdFor(alert),
  }));
}

function buildSeedAuditEvents(cases: ReviewCaseRecord[]): AuditEventRecord[] {
  return cases.map((reviewCase) => ({
    id: `audit_${reviewCase.id}_created`,
    caseId: reviewCase.id,
    type: "case_created",
    actor: "Sentinel Seeding",
    note: `${reviewCase.transactionId} entered the analyst queue with ${reviewCase.score}/100 risk.`,
    createdAt: reviewCase.createdAt,
    metadata: {
      status: reviewCase.status,
      merchant: reviewCase.merchantName,
    },
  }));
}

function buildSeedGraphSnapshot(): GraphSnapshotRecord {
  return buildGraphSnapshot(getDashboardSnapshot().transactions);
}

function buildSeedComments(cases: ReviewCaseRecord[]): CaseCommentRecord[] {
  return cases.slice(0, 2).map((reviewCase, index) => ({
    id: `comment_${reviewCase.id}_${index + 1}`,
    caseId: reviewCase.id,
    author: index === 0 ? "Fraud Ops Analyst" : "Risk Lead",
    content:
      index === 0
        ? "Device freshness and retry pressure make this queue candidate stronger than a clean failure retry."
        : "Keep this merchant under strict watch until the next settlement cycle completes.",
    createdAt: reviewCase.createdAt,
  }));
}

function buildSeedOverrides(cases: ReviewCaseRecord[]): MerchantOverrideRecord[] {
  const primary = cases[0];

  if (!primary) {
    return [];
  }

  return [
    {
      merchantId: primary.merchantId,
      merchantName: primary.merchantName,
      strategy: "strict",
      thresholdOffset: -4,
      autoHoldOffset: -3,
      reason: "Chargeback pressure and clustered retries justify tighter merchant-scoped controls.",
      updatedAt: primary.createdAt,
    },
  ];
}

function extractNumericAmount(amount: string) {
  const digits = amount.replace(/[^\d]/g, "");
  return digits.length > 0 ? Number(digits) : 0;
}

function buildConsensusApprovals(
  defense: ReturnType<typeof buildDefenseLabSnapshot>,
  limit = 8,
): AgentApprovalRequestRecord[] {
  return defense.events.slice(0, limit).map((event, index) => {
    const frame = defense.frames.find((entry) => entry.tick === event.tick);
    const agentActions = frame?.agentActions ?? [];
    const action =
      event.outcome === "hold"
        ? "Hold this payment and pause the merchant lane for 30 minutes"
        : event.outcome === "step-up"
          ? "Require device verification and send the payment to manual review"
          : "Keep the payment under watch until one more linked signal appears";
    const evidence = agentActions
      .slice(0, 4)
      .map((entry) => entry.reasoning)
      .join(" ");

    return {
      id: `approval_consensus_${event.id}`,
      tick: event.tick,
      agentId: "agent_consensus_team",
      agentName: "Sentinel Team",
      targetType: "payment",
      targetId: event.transactionId,
      targetLabel: `${event.merchantName} - ${event.transactionId}`,
      action,
      rationale: `All ${agentActions.length || defense.agentRoster.length} agents reached the same decision. ${evidence}`,
      status: "pending",
      requestedAt: new Date(Date.parse(defense.generatedAt) + index * 2000).toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
    } satisfies AgentApprovalRequestRecord;
  });
}

function findConsensusApprovalFromDefense(
  defense: ReturnType<typeof buildDefenseLabSnapshot>,
  approvalId: string,
) {
  return buildConsensusApprovals(defense, defense.events.length).find(
    (approval) => approval.id === approvalId,
  );
}

function buildAgentRuntimeRecords(
  config: DefenseLabConfig,
  replayCohort: ReplayCohort,
  merchantOverrides: MerchantOverrideRecord[],
): {
  memories: AgentMemoryRecord[];
  approvals: AgentApprovalRequestRecord[];
  telemetry: AgentTelemetryRecord[];
} {
  const defense = buildDefenseLabSnapshot({
    ...config,
    replayCohort,
    merchantOverrides,
  });

  const memories = defense.agentActions.slice(0, 12).map((action, index) => ({
    id: `memory_${action.id}`,
    agentId: action.agentId,
    agentName: action.agentName,
    scopeType: action.targetType,
    scopeId: action.targetId,
    scopeLabel: action.targetLabel,
    title: `${action.agentName} learned on ${action.targetLabel}`,
    summary: action.reasoning,
    confidence: action.confidence,
    tags: [action.role, action.action, replayCohort].map((tag) => tag.replace(/\s+/g, "_")),
    createdAt: new Date(Date.parse(defense.generatedAt) + index * 1000).toISOString(),
  }));

  const approvals = buildConsensusApprovals(defense);

  const telemetry = defense.agentRoster.map((agent) => {
    const actions = defense.agentActions.filter((action) => action.agentId === agent.id);
    const linkedEvents = defense.events.filter((event) => actions.some((action) => action.tick === event.tick));
    const decisions = actions.length;
    const avgConfidence =
      actions.reduce((total, action) => total + action.confidence, 0) / Math.max(actions.length, 1);
    const queueDelta = actions.filter((action) => action.targetType === "queue").length;
    const estimatedLossPrevented = linkedEvents.reduce((total, event) => {
      const amount = extractNumericAmount(event.amount);
      if (event.outcome === "hold") return total + amount;
      if (event.outcome === "step-up") return total + Math.round(amount * 0.42);
      return total;
    }, 0);

    return {
      id: `telemetry_${agent.id}_${replayCohort}`,
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      tick: linkedEvents.at(-1)?.tick ?? 0,
      decisions,
      avgConfidence,
      queueDelta,
      estimatedLossPrevented,
      createdAt: defense.generatedAt,
    } satisfies AgentTelemetryRecord;
  });

  return {
    memories,
    approvals,
    telemetry,
  };
}

function buildAgentRuntimeRecordsFromDefense(
  defense: ReturnType<typeof buildDefenseLabSnapshot>,
  replayCohort: ReplayCohort,
): {
  memories: AgentMemoryRecord[];
  approvals: AgentApprovalRequestRecord[];
  telemetry: AgentTelemetryRecord[];
} {
  const memories = defense.agentActions.slice(0, 12).map((action, index) => ({
    id: `memory_${action.id}`,
    agentId: action.agentId,
    agentName: action.agentName,
    scopeType: action.targetType,
    scopeId: action.targetId,
    scopeLabel: action.targetLabel,
    title: `${action.agentName} learned on ${action.targetLabel}`,
    summary: action.reasoning,
    confidence: action.confidence,
    tags: [action.role, action.action, replayCohort].map((tag) => tag.replace(/\s+/g, "_")),
    createdAt: new Date(Date.parse(defense.generatedAt) + index * 1000).toISOString(),
  }));

  const approvals = buildConsensusApprovals(defense);

  const telemetry = defense.agentRoster.map((agent) => {
    const actions = defense.agentActions.filter((action) => action.agentId === agent.id);
    const linkedEvents = defense.events.filter((event) => actions.some((action) => action.tick === event.tick));
    const decisions = actions.length;
    const avgConfidence =
      actions.reduce((total, action) => total + action.confidence, 0) / Math.max(actions.length, 1);
    const queueDelta = actions.filter((action) => action.targetType === "queue").length;
    const estimatedLossPrevented = linkedEvents.reduce((total, event) => {
      const amount = extractNumericAmount(event.amount);
      if (event.outcome === "hold") return total + amount;
      if (event.outcome === "step-up") return total + Math.round(amount * 0.42);
      return total;
    }, 0);

    return {
      id: `telemetry_${agent.id}_${replayCohort}`,
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      tick: linkedEvents.at(-1)?.tick ?? 0,
      decisions,
      avgConfidence,
      queueDelta,
      estimatedLossPrevented,
      createdAt: defense.generatedAt,
    } satisfies AgentTelemetryRecord;
  });

  return {
    memories,
    approvals,
    telemetry,
  };
}

function createInitialStore(): OpsStore {
  const cases = buildSeedCases();
  const seedComments = buildSeedComments(cases);
  const merchantOverrides = buildSeedOverrides(cases);
  const policy = buildPolicyArtifact(DEFAULT_CONFIG, null, "linked_attacks", merchantOverrides);
  const graph = buildSeedGraphSnapshot();
  const simulatorRun = buildSimulatorRun(DEFAULT_CONFIG, "linked_attacks", merchantOverrides);
  const agentRuntime = buildAgentRuntimeRecords(DEFAULT_CONFIG, "linked_attacks", merchantOverrides);

  return {
    version: 2,
    cases,
    caseComments: seedComments,
    auditEvents: [
      ...buildSeedAuditEvents(cases),
      {
        id: "audit_policy_seed",
        caseId: null,
        type: "policy_evaluated",
        actor: "Sentinel Seeding",
        note: `Baseline policy seeded at threshold ${policy.config.threshold} with ${Math.round(policy.precision * 100)}% precision.`,
        createdAt: policy.generatedAt,
      },
      {
        id: "audit_graph_seed",
        caseId: null,
        type: "graph_refreshed",
        actor: "Sentinel Seeding",
        note: `Defense graph seeded with ${graph.clusters.length} suspicious clusters.`,
        createdAt: graph.generatedAt,
      },
      {
        id: "audit_sim_seed",
        caseId: null,
        type: "simulator_run_saved",
        actor: "Sentinel Seeding",
        note: `Baseline simulator replay saved with ${Math.round(simulatorRun.precision * 100)}% precision.`,
        createdAt: simulatorRun.createdAt,
      },
    ],
    policyArtifacts: [policy],
    graphSnapshots: [graph],
    simulatorRuns: [simulatorRun],
    merchantOverrides,
    agentMemories: agentRuntime.memories,
    agentApprovalRequests: agentRuntime.approvals,
    agentTelemetry: agentRuntime.telemetry,
  };
}

async function ensureStoreFile() {
  await mkdir(STORE_DIR, { recursive: true });

  try {
    await readFile(STORE_PATH, "utf8");
  } catch {
    const initialStore = createInitialStore();
    await writeFile(STORE_PATH, JSON.stringify(initialStore, null, 2), "utf8");
  }
}

async function readLegacyStoreFile(): Promise<OpsStore> {
  await ensureStoreFile();
  const raw = await readFile(STORE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<OpsStore>;
  const merchantOverrides = parsed.merchantOverrides ?? [];
  const latestRun = (parsed.simulatorRuns ?? [])[0];
  const agentRuntime = buildAgentRuntimeRecords(
    latestRun?.config ?? DEFAULT_CONFIG,
    latestRun?.replayCohort ?? "linked_attacks",
    merchantOverrides,
  );

  return {
    version: 2,
    cases: parsed.cases ?? [],
    caseComments: parsed.caseComments ?? [],
    auditEvents: parsed.auditEvents ?? [],
    policyArtifacts: parsed.policyArtifacts ?? [],
    graphSnapshots: parsed.graphSnapshots ?? [],
    simulatorRuns: (parsed.simulatorRuns ?? []).map((run) => ({
      ...run,
      replayCohort: run.replayCohort ?? "linked_attacks",
      interventions: run.interventions ?? [],
    })),
    merchantOverrides,
    agentMemories: parsed.agentMemories ?? agentRuntime.memories,
    agentApprovalRequests: parsed.agentApprovalRequests ?? agentRuntime.approvals,
    agentTelemetry: parsed.agentTelemetry ?? agentRuntime.telemetry,
  };
}

async function ensurePostgresSchema() {
  if (!hasDatabaseUrl()) return;

  if (!schemaPromise) {
    schemaPromise = withDatabaseTransaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_cases (
          id TEXT PRIMARY KEY,
          alert_id TEXT NOT NULL,
          transaction_id TEXT NOT NULL,
          merchant_id TEXT NOT NULL,
          merchant_name TEXT NOT NULL,
          severity TEXT NOT NULL,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          score INTEGER NOT NULL,
          exposure INTEGER NOT NULL,
          reason TEXT NOT NULL,
          recommendation TEXT NOT NULL,
          status TEXT NOT NULL,
          assignee TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          cluster_id TEXT NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_case_comments (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_audit_events (
          id TEXT PRIMARY KEY,
          case_id TEXT NULL,
          type TEXT NOT NULL,
          actor TEXT NOT NULL,
          note TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          metadata JSONB NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_policy_artifacts (
          id TEXT PRIMARY KEY,
          generated_at TIMESTAMPTZ NOT NULL,
          config JSONB NOT NULL,
          precision DOUBLE PRECISION NOT NULL,
          recall DOUBLE PRECISION NOT NULL,
          false_positive_rate DOUBLE PRECISION NOT NULL,
          false_positive_cost DOUBLE PRECISION NOT NULL,
          loss_avoided DOUBLE PRECISION NOT NULL,
          review_load INTEGER NOT NULL,
          recommendation TEXT NOT NULL,
          measurable_outcome TEXT NOT NULL,
          calibration JSONB NOT NULL,
          challenger JSONB NULL,
          drift JSONB NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_graph_snapshots (
          id TEXT PRIMARY KEY,
          generated_at TIMESTAMPTZ NOT NULL,
          nodes JSONB NOT NULL,
          edges JSONB NOT NULL,
          clusters JSONB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_simulator_runs (
          id TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL,
          config JSONB NOT NULL,
          replay_cohort TEXT NOT NULL,
          summary_title TEXT NOT NULL,
          summary_subtitle TEXT NOT NULL,
          review_load INTEGER NOT NULL,
          precision DOUBLE PRECISION NOT NULL,
          recall DOUBLE PRECISION NOT NULL,
          false_positive_cost DOUBLE PRECISION NOT NULL,
          loss_avoided DOUBLE PRECISION NOT NULL,
          cluster_ids JSONB NOT NULL,
          interventions JSONB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_merchant_overrides (
          merchant_id TEXT PRIMARY KEY,
          merchant_name TEXT NOT NULL,
          strategy TEXT NOT NULL,
          threshold_offset INTEGER NOT NULL,
          auto_hold_offset INTEGER NOT NULL,
          reason TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_agent_memories (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          scope_label TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          confidence DOUBLE PRECISION NOT NULL,
          tags JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_agent_approval_requests (
          id TEXT PRIMARY KEY,
          tick INTEGER NOT NULL,
          agent_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_label TEXT NOT NULL,
          action TEXT NOT NULL,
          rationale TEXT NOT NULL,
          status TEXT NOT NULL,
          requested_at TIMESTAMPTZ NOT NULL,
          resolved_at TIMESTAMPTZ NULL,
          resolved_by TEXT NULL,
          resolution_note TEXT NULL
        );
        CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}_agent_telemetry (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          role TEXT NOT NULL,
          tick INTEGER NOT NULL,
          decisions INTEGER NOT NULL,
          avg_confidence DOUBLE PRECISION NOT NULL,
          queue_delta INTEGER NOT NULL,
          estimated_loss_prevented DOUBLE PRECISION NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
      `);
    });
  }

  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}

async function writePostgresStore(client: PoolClient, store: OpsStore) {
  await client.query(`DELETE FROM ${TABLE_PREFIX}_case_comments`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_audit_events`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_cases`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_policy_artifacts`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_graph_snapshots`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_simulator_runs`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_merchant_overrides`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_agent_memories`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_agent_approval_requests`);
  await client.query(`DELETE FROM ${TABLE_PREFIX}_agent_telemetry`);

  for (const reviewCase of store.cases) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_cases (
        id, alert_id, transaction_id, merchant_id, merchant_name, severity, title, type, score, exposure, reason,
        recommendation, status, assignee, created_at, updated_at, cluster_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        reviewCase.id,
        reviewCase.alertId,
        reviewCase.transactionId,
        reviewCase.merchantId,
        reviewCase.merchantName,
        reviewCase.severity,
        reviewCase.title,
        reviewCase.type,
        reviewCase.score,
        reviewCase.exposure,
        reviewCase.reason,
        reviewCase.recommendation,
        reviewCase.status,
        reviewCase.assignee,
        reviewCase.createdAt,
        reviewCase.updatedAt,
        reviewCase.clusterId,
      ],
    );
  }

  for (const comment of store.caseComments) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_case_comments (id, case_id, author, content, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [comment.id, comment.caseId, comment.author, comment.content, comment.createdAt],
    );
  }

  for (const event of store.auditEvents) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_audit_events (id, case_id, type, actor, note, created_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        event.id,
        event.caseId,
        event.type,
        event.actor,
        event.note,
        event.createdAt,
        JSON.stringify(event.metadata ?? null),
      ],
    );
  }

  for (const artifact of store.policyArtifacts) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_policy_artifacts (
        id, generated_at, config, precision, recall, false_positive_rate, false_positive_cost,
        loss_avoided, review_load, recommendation, measurable_outcome, calibration, challenger, drift
      ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)`,
      [
        artifact.id,
        artifact.generatedAt,
        JSON.stringify(artifact.config),
        artifact.precision,
        artifact.recall,
        artifact.falsePositiveRate,
        artifact.falsePositiveCost,
        artifact.lossAvoided,
        artifact.reviewLoad,
        artifact.recommendation,
        artifact.measurableOutcome,
        JSON.stringify(artifact.calibration),
        JSON.stringify(artifact.challenger ?? null),
        JSON.stringify(artifact.drift ?? null),
      ],
    );
  }

  for (const graph of store.graphSnapshots) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_graph_snapshots (id, generated_at, nodes, edges, clusters)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)`,
      [graph.id, graph.generatedAt, JSON.stringify(graph.nodes), JSON.stringify(graph.edges), JSON.stringify(graph.clusters)],
    );
  }

  for (const run of store.simulatorRuns) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_simulator_runs (
        id, created_at, config, replay_cohort, summary_title, summary_subtitle, review_load, precision,
        recall, false_positive_cost, loss_avoided, cluster_ids, interventions
      ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
      [
        run.id,
        run.createdAt,
        JSON.stringify(run.config),
        run.replayCohort,
        run.summaryTitle,
        run.summarySubtitle,
        run.reviewLoad,
        run.precision,
        run.recall,
        run.falsePositiveCost,
        run.lossAvoided,
        JSON.stringify(run.clusterIds),
        JSON.stringify(run.interventions),
      ],
    );
  }

  for (const override of store.merchantOverrides) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_merchant_overrides (
        merchant_id, merchant_name, strategy, threshold_offset, auto_hold_offset, reason, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        override.merchantId,
        override.merchantName,
        override.strategy,
        override.thresholdOffset,
        override.autoHoldOffset,
        override.reason,
        override.updatedAt,
      ],
    );
  }

  for (const memory of store.agentMemories) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_agent_memories (
        id, agent_id, agent_name, scope_type, scope_id, scope_label, title, summary, confidence, tags, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
      [
        memory.id,
        memory.agentId,
        memory.agentName,
        memory.scopeType,
        memory.scopeId,
        memory.scopeLabel,
        memory.title,
        memory.summary,
        memory.confidence,
        JSON.stringify(memory.tags),
        memory.createdAt,
      ],
    );
  }

  for (const approval of store.agentApprovalRequests) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_agent_approval_requests (
        id, tick, agent_id, agent_name, target_type, target_id, target_label, action, rationale, status,
        requested_at, resolved_at, resolved_by, resolution_note
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        approval.id,
        approval.tick,
        approval.agentId,
        approval.agentName,
        approval.targetType,
        approval.targetId,
        approval.targetLabel,
        approval.action,
        approval.rationale,
        approval.status,
        approval.requestedAt,
        approval.resolvedAt ?? null,
        approval.resolvedBy ?? null,
        approval.resolutionNote ?? null,
      ],
    );
  }

  for (const telemetry of store.agentTelemetry) {
    await client.query(
      `INSERT INTO ${TABLE_PREFIX}_agent_telemetry (
        id, agent_id, agent_name, role, tick, decisions, avg_confidence, queue_delta, estimated_loss_prevented, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        telemetry.id,
        telemetry.agentId,
        telemetry.agentName,
        telemetry.role,
        telemetry.tick,
        telemetry.decisions,
        telemetry.avgConfidence,
        telemetry.queueDelta,
        telemetry.estimatedLossPrevented,
        telemetry.createdAt,
      ],
    );
  }
}

async function bootstrapPostgresIfEmpty() {
  await ensurePostgresSchema();
  const { rows } = await queryDb<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${TABLE_PREFIX}_cases`);

  if ((rows[0]?.count ?? "0") !== "0") {
    return;
  }

  const seed = await readLegacyStoreFile();
  await withDatabaseTransaction(async (client) => {
    await writePostgresStore(client, seed);
  });
}

async function readPostgresStore(): Promise<OpsStore> {
  await bootstrapPostgresIfEmpty();

  const [cases, caseComments, auditEvents, policyArtifacts, graphSnapshots, simulatorRuns, merchantOverrides, agentMemories, agentApprovalRequests, agentTelemetry] =
    await Promise.all([
      queryDb<{
        id: string;
        alert_id: string;
        transaction_id: string;
        merchant_id: string;
        merchant_name: string;
        severity: ReviewCaseRecord["severity"];
        title: string;
        type: string;
        score: number;
        exposure: number;
        reason: string;
        recommendation: string;
        status: ReviewCaseRecord["status"];
        assignee: string;
        created_at: string;
        updated_at: string;
        cluster_id: string | null;
      }>(`SELECT * FROM ${TABLE_PREFIX}_cases ORDER BY score DESC, created_at DESC`),
      queryDb<{ id: string; case_id: string; author: string; content: string; created_at: string }>(
        `SELECT * FROM ${TABLE_PREFIX}_case_comments ORDER BY created_at ASC`,
      ),
      queryDb<{
        id: string;
        case_id: string | null;
        type: AuditEventRecord["type"];
        actor: string;
        note: string;
        created_at: string;
        metadata: Record<string, string> | null;
      }>(`SELECT * FROM ${TABLE_PREFIX}_audit_events ORDER BY created_at DESC`),
      queryDb<{
        id: string;
        generated_at: string;
        config: DefenseLabConfig;
        precision: number;
        recall: number;
        false_positive_rate: number;
        false_positive_cost: number;
        loss_avoided: number;
        review_load: number;
        recommendation: string;
        measurable_outcome: string;
        calibration: CalibrationBin[];
        challenger: PolicyArtifactRecord["challenger"] | null;
        drift: PolicyArtifactRecord["drift"] | null;
      }>(`SELECT * FROM ${TABLE_PREFIX}_policy_artifacts ORDER BY generated_at DESC`),
      queryDb<{
        id: string;
        generated_at: string;
        nodes: GraphSnapshotRecord["nodes"];
        edges: GraphSnapshotRecord["edges"];
        clusters: GraphSnapshotRecord["clusters"];
      }>(`SELECT * FROM ${TABLE_PREFIX}_graph_snapshots ORDER BY generated_at DESC`),
      queryDb<{
        id: string;
        created_at: string;
        config: DefenseLabConfig;
        replay_cohort: ReplayCohort;
        summary_title: string;
        summary_subtitle: string;
        review_load: number;
        precision: number;
        recall: number;
        false_positive_cost: number;
        loss_avoided: number;
        cluster_ids: string[];
        interventions: SimulatorInterventionRecord[];
      }>(`SELECT * FROM ${TABLE_PREFIX}_simulator_runs ORDER BY created_at DESC`),
      queryDb<{
        merchant_id: string;
        merchant_name: string;
        strategy: MerchantOverrideRecord["strategy"];
        threshold_offset: number;
        auto_hold_offset: number;
        reason: string;
        updated_at: string;
      }>(`SELECT * FROM ${TABLE_PREFIX}_merchant_overrides ORDER BY updated_at DESC`),
      queryDb<{
        id: string;
        agent_id: string;
        agent_name: string;
        scope_type: AgentMemoryRecord["scopeType"];
        scope_id: string;
        scope_label: string;
        title: string;
        summary: string;
        confidence: number;
        tags: string[];
        created_at: string;
      }>(`SELECT * FROM ${TABLE_PREFIX}_agent_memories ORDER BY created_at DESC`),
      queryDb<{
        id: string;
        tick: number;
        agent_id: string;
        agent_name: string;
        target_type: AgentApprovalRequestRecord["targetType"];
        target_id: string;
        target_label: string;
        action: string;
        rationale: string;
        status: AgentApprovalRequestRecord["status"];
        requested_at: string;
        resolved_at: string | null;
        resolved_by: string | null;
        resolution_note: string | null;
      }>(`SELECT * FROM ${TABLE_PREFIX}_agent_approval_requests ORDER BY requested_at DESC`),
      queryDb<{
        id: string;
        agent_id: string;
        agent_name: string;
        role: string;
        tick: number;
        decisions: number;
        avg_confidence: number;
        queue_delta: number;
        estimated_loss_prevented: number;
        created_at: string;
      }>(`SELECT * FROM ${TABLE_PREFIX}_agent_telemetry ORDER BY created_at DESC, decisions DESC`),
    ]);

  return {
    version: 2,
    cases: cases.rows.map((row) => ({
      id: row.id,
      alertId: row.alert_id,
      transactionId: row.transaction_id,
      merchantId: row.merchant_id,
      merchantName: row.merchant_name,
      severity: row.severity,
      title: row.title,
      type: row.type,
      score: row.score,
      exposure: row.exposure,
      reason: row.reason,
      recommendation: row.recommendation,
      status: row.status,
      assignee: row.assignee,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      clusterId: row.cluster_id,
    })),
    caseComments: caseComments.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      author: row.author,
      content: row.content,
      createdAt: row.created_at,
    })),
    auditEvents: auditEvents.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      type: row.type,
      actor: row.actor,
      note: row.note,
      createdAt: row.created_at,
      metadata: row.metadata ?? undefined,
    })),
    policyArtifacts: policyArtifacts.rows.map((row) => ({
      id: row.id,
      generatedAt: row.generated_at,
      config: row.config,
      precision: row.precision,
      recall: row.recall,
      falsePositiveRate: row.false_positive_rate,
      falsePositiveCost: row.false_positive_cost,
      lossAvoided: row.loss_avoided,
      reviewLoad: row.review_load,
      recommendation: row.recommendation,
      measurableOutcome: row.measurable_outcome,
      calibration: row.calibration,
      challenger: row.challenger ?? undefined,
      drift: row.drift ?? undefined,
    })),
    graphSnapshots: graphSnapshots.rows.map((row) => ({
      id: row.id,
      generatedAt: row.generated_at,
      nodes: row.nodes,
      edges: row.edges,
      clusters: row.clusters,
    })),
    simulatorRuns: simulatorRuns.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      config: row.config,
      replayCohort: row.replay_cohort,
      summaryTitle: row.summary_title,
      summarySubtitle: row.summary_subtitle,
      reviewLoad: row.review_load,
      precision: row.precision,
      recall: row.recall,
      falsePositiveCost: row.false_positive_cost,
      lossAvoided: row.loss_avoided,
      clusterIds: row.cluster_ids,
      interventions: row.interventions ?? [],
    })),
    merchantOverrides: merchantOverrides.rows.map((row) => ({
      merchantId: row.merchant_id,
      merchantName: row.merchant_name,
      strategy: row.strategy,
      thresholdOffset: row.threshold_offset,
      autoHoldOffset: row.auto_hold_offset,
      reason: row.reason,
      updatedAt: row.updated_at,
    })),
    agentMemories: agentMemories.rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      scopeLabel: row.scope_label,
      title: row.title,
      summary: row.summary,
      confidence: row.confidence,
      tags: row.tags ?? [],
      createdAt: row.created_at,
    })),
    agentApprovalRequests: agentApprovalRequests.rows.map((row) => ({
      id: row.id,
      tick: row.tick,
      agentId: row.agent_id,
      agentName: row.agent_name,
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: row.target_label,
      action: row.action,
      rationale: row.rationale,
      status: row.status,
      requestedAt: row.requested_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      resolutionNote: row.resolution_note,
    })),
    agentTelemetry: agentTelemetry.rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      role: row.role,
      tick: row.tick,
      decisions: row.decisions,
      avgConfidence: row.avg_confidence,
      queueDelta: row.queue_delta,
      estimatedLossPrevented: row.estimated_loss_prevented,
      createdAt: row.created_at,
    })),
  };
}

export async function readOpsStore(options?: {
  allowDegradedFallback?: boolean;
}): Promise<OpsStore> {
  if (hasDatabaseUrl()) {
    try {
      return await readOperationalData({
        readPrimary: async () => {
          const store = await readPostgresStore();
          lastKnownPostgresStore = structuredClone(store);
          return store;
        },
        readFallback: () => structuredClone(lastKnownPostgresStore ?? createInitialStore()),
        allowDegradedFallback: options?.allowDegradedFallback === true,
        fallbackAfterMs: 2_000,
      });
    } catch {
      return readLegacyStoreFile();
    }
  }

  return readLegacyStoreFile();
}

async function writeOpsStore(store: OpsStore): Promise<void> {
  if (hasDatabaseUrl()) {
    try {
      await ensurePostgresSchema();
      await withDatabaseTransaction(async (client) => {
        await writePostgresStore(client, store);
      });
      return;
    } catch {
      // Local development can continue against its JSON store when PostgreSQL is unavailable.
    }
  }

  await ensureStoreFile();
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function saveAgentApprovalResolution(
  approval: AgentApprovalRequestRecord,
  auditEvent: AuditEventRecord,
): Promise<void> {
  if (hasDatabaseUrl()) {
    try {
      await ensurePostgresSchema();
      await withDatabaseTransaction(async (client) => {
        await client.query(
          `INSERT INTO ${TABLE_PREFIX}_agent_approval_requests (
            id, tick, agent_id, agent_name, target_type, target_id, target_label, action, rationale, status,
            requested_at, resolved_at, resolved_by, resolution_note
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            resolved_at = EXCLUDED.resolved_at,
            resolved_by = EXCLUDED.resolved_by,
            resolution_note = EXCLUDED.resolution_note`,
          [
            approval.id,
            approval.tick,
            approval.agentId,
            approval.agentName,
            approval.targetType,
            approval.targetId,
            approval.targetLabel,
            approval.action,
            approval.rationale,
            approval.status,
            approval.requestedAt,
            approval.resolvedAt ?? null,
            approval.resolvedBy ?? null,
            approval.resolutionNote ?? null,
          ],
        );
        await client.query(
          `INSERT INTO ${TABLE_PREFIX}_audit_events (
            id, case_id, type, actor, note, created_at, metadata
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
          ON CONFLICT (id) DO NOTHING`,
          [
            auditEvent.id,
            auditEvent.caseId,
            auditEvent.type,
            auditEvent.actor,
            auditEvent.note,
            auditEvent.createdAt,
            JSON.stringify(auditEvent.metadata ?? null),
          ],
        );
      });
      return;
    } catch {
      // Keep the local console usable through the JSON store while PostgreSQL restarts.
    }
  }

  const store = await readLegacyStoreFile();
  const existingIndex = store.agentApprovalRequests.findIndex(
    (entry) => entry.id === approval.id,
  );
  if (existingIndex === -1) store.agentApprovalRequests.unshift(approval);
  else store.agentApprovalRequests[existingIndex] = approval;
  store.auditEvents.unshift(auditEvent);
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function withOpsStore<T>(mutate: (store: OpsStore) => T | Promise<T>): Promise<T> {
  const store = await readOpsStore();
  const result = await mutate(store);
  await writeOpsStore(store);
  return result;
}

export {
  alertDisplayId,
  buildAgentRuntimeRecordsFromDefense,
  buildPolicyArtifact,
  buildSeedGraphSnapshot,
  buildSimulatorRun,
  caseTitle,
  findConsensusApprovalFromDefense,
};
