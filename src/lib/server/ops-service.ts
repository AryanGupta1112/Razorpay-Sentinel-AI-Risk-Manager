import "server-only";

import { enrichDefenseLabWithAgentReasoning, getCopilotProviderLabel } from "@/lib/agent-llm";
import { buildDefenseLabSnapshot, DEFAULT_CONFIG } from "@/lib/simulation-engine";
import { buildConsoleData, type ConsoleData } from "@/lib/console-adapters";
import { getDashboardSnapshot } from "@/lib/risk-engine";
import { buildGraphSnapshot } from "@/lib/server/graph-intelligence";
import {
  alertDisplayId,
  buildAgentRuntimeRecordsFromDefense,
  buildPolicyArtifact,
  buildSeedGraphSnapshot,
  buildSimulatorRun,
  caseTitle,
  readOpsStore,
  withOpsStore,
  writeOpsStore,
} from "@/lib/server/ops-store";
import {
  deleteCachedByPrefix,
  deleteCachedKeys,
  readCachedJson,
  writeCachedJson,
} from "@/lib/server/runtime-cache";
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
  ReviewCaseStatus,
  SimulatorInterventionRecord,
  SimulatorRunRecord,
} from "@/types/ops";
import type { DefenseLabConfig, ReplayCohort, RiskTransaction } from "@/types/risk";

type ConsoleBootstrap = {
  data: ConsoleData;
  cases: ReviewCaseRecord[];
  caseComments: CaseCommentRecord[];
  merchantOverrides: MerchantOverrideRecord[];
  latestPolicyArtifact: PolicyArtifactRecord;
  latestGraphSnapshot: GraphSnapshotRecord;
  latestSimulatorRun: SimulatorRunRecord;
  auditEvents: AuditEventRecord[];
  agentMemories: AgentMemoryRecord[];
  agentApprovalRequests: AgentApprovalRequestRecord[];
  agentTelemetry: AgentTelemetryRecord[];
};

const DEFAULT_ACTOR = "Sentinel Ops";
const CONSOLE_CACHE_TTL_SECONDS = 20;
const COPILOT_CACHE_TTL_SECONDS = 20;

function providerLabel() {
  return getCopilotProviderLabel();
}

function latest<T extends { generatedAt?: string; createdAt?: string }>(items: T[]): T | undefined {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.generatedAt ?? left.createdAt ?? 0).getTime();
    const rightTime = new Date(right.generatedAt ?? right.createdAt ?? 0).getTime();
    return rightTime - leftTime;
  })[0];
}

function serializedConfigKey(config?: Partial<DefenseLabConfig> & { replayCohort?: ReplayCohort }) {
  if (!config) return "default";

  return (
    Object.entries(config)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${String(value)}`)
      .join("|") || "default"
  );
}

function consoleCacheKey(config?: Partial<DefenseLabConfig> & { replayCohort?: ReplayCohort }) {
  return `sentinel:console:${serializedConfigKey(config)}`;
}

function copilotCacheKey() {
  return "sentinel:copilot:context:v2";
}

async function invalidateOperationalCaches() {
  await Promise.all([deleteCachedKeys([copilotCacheKey()]), deleteCachedByPrefix("sentinel:console:")]);
}

function reconcileCases(
  seededCases: ReviewCaseRecord[],
  alerts: RiskTransaction[],
  generatedAt: string,
): { created: ReviewCaseRecord[] } {
  const existing = new Map(seededCases.map((reviewCase) => [reviewCase.transactionId, reviewCase]));
  const created: ReviewCaseRecord[] = [];

  alerts.forEach((alert) => {
    const current = existing.get(alert.id);

    if (current) {
      current.alertId = alertDisplayId(alert.id);
      current.score = alert.score;
      current.reason = alert.explanation;
      current.recommendation = alert.recommendation;
      current.title = caseTitle(alert);
      current.type = alert.triggers[0]?.code ?? current.type;
      current.severity = alert.severity;
      current.exposure = alert.amount;
      current.clusterId = alert.triggers[0]?.code ? `graph_${alert.triggers[0].code}` : null;
      current.updatedAt = generatedAt;
      return;
    }

    const reviewCase: ReviewCaseRecord = {
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
      status: "open",
      assignee: "Risk Queue",
      createdAt: generatedAt,
      updatedAt: generatedAt,
      clusterId: alert.triggers[0]?.code ? `graph_${alert.triggers[0].code}` : null,
    };

    seededCases.push(reviewCase);
    created.push(reviewCase);
  });

  return { created };
}

function refreshAgentRuntime(
  defense: ReturnType<typeof buildDefenseLabSnapshot>,
  replayCohort: ReplayCohort,
  existingApprovals: AgentApprovalRequestRecord[] = [],
) {
  const runtime = buildAgentRuntimeRecordsFromDefense(defense, replayCohort);
  const nonPending = existingApprovals.filter((approval) => approval.status !== "pending");
  const pendingAndAuto = runtime.approvals.filter(
    (approval) =>
      !nonPending.some(
        (existing) =>
          existing.agentId === approval.agentId &&
          existing.action === approval.action &&
          existing.targetId === approval.targetId &&
          existing.tick === approval.tick,
      ),
  );

  return {
    memories: runtime.memories,
    approvals: [...nonPending, ...pendingAndAuto].sort(
      (left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime(),
    ),
    telemetry: runtime.telemetry,
  };
}

async function ensureOperationalStore(
  requestedInput?: Partial<DefenseLabConfig> & { replayCohort?: ReplayCohort },
  options?: { enrichAgentReasoning?: boolean; allowDegradedFallback?: boolean },
): Promise<{
  snapshot: ReturnType<typeof getDashboardSnapshot>;
  defense: ReturnType<typeof buildDefenseLabSnapshot>;
  store: Awaited<ReturnType<typeof readOpsStore>>;
}> {
  const snapshot = getDashboardSnapshot();
  const store = await readOpsStore({
    allowDegradedFallback: options?.allowDegradedFallback,
  });
  const latestRun = latest(store.simulatorRuns);
  const activeConfig = { ...(latestRun?.config ?? DEFAULT_CONFIG), ...(requestedInput ?? {}) };
  const replayCohort = requestedInput?.replayCohort ?? latestRun?.replayCohort ?? "linked_attacks";
  const seededDefense = buildDefenseLabSnapshot({
    ...activeConfig,
    replayCohort,
    merchantOverrides: store.merchantOverrides,
  });
  const defense =
    options?.enrichAgentReasoning === false
      ? seededDefense
      : await enrichDefenseLabWithAgentReasoning(seededDefense);
  const { created } = reconcileCases(store.cases, snapshot.alerts, snapshot.generatedAt);
  const runtime = refreshAgentRuntime(defense, replayCohort, store.agentApprovalRequests);

  store.agentMemories = runtime.memories;
  store.agentApprovalRequests = runtime.approvals;
  store.agentTelemetry = runtime.telemetry;

  if (created.length > 0) {
    store.auditEvents.unshift(
      ...created.map((reviewCase) => ({
        id: `audit_${reviewCase.id}_${reviewCase.createdAt}`,
        caseId: reviewCase.id,
        type: "case_created" as const,
        actor: "Sentinel Sync",
        note: `${reviewCase.transactionId} was added to the analyst queue after a new alert sync.`,
        createdAt: reviewCase.createdAt,
      })),
    );
    await writeOpsStore(store);
    await invalidateOperationalCaches();
  }

  return { snapshot, defense, store };
}

export async function getConsoleBootstrap(
  requestedConfig?: Partial<DefenseLabConfig> & { replayCohort?: ReplayCohort },
  options?: { bypassCache?: boolean; enrichAgentReasoning?: boolean },
): Promise<ConsoleBootstrap> {
  const cacheKey = consoleCacheKey(requestedConfig);
  if (!options?.bypassCache) {
    const cached = await readCachedJson<ConsoleBootstrap>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const { snapshot, defense, store } = await ensureOperationalStore(requestedConfig, {
    ...options,
    allowDegradedFallback: true,
  });
  const latestPolicyArtifact =
    latest(store.policyArtifacts) ??
    buildPolicyArtifact(defense.config, null, requestedConfig?.replayCohort ?? "linked_attacks", store.merchantOverrides);
  const latestGraphSnapshot = latest(store.graphSnapshots) ?? buildSeedGraphSnapshot();
  const latestSimulatorRun =
    latest(store.simulatorRuns) ??
    buildSimulatorRun(defense.config, requestedConfig?.replayCohort ?? "linked_attacks", store.merchantOverrides);
  const baselinePolicyArtifact = latestPolicyArtifact.challenger
    ? store.policyArtifacts.find((artifact) => artifact.id === latestPolicyArtifact.challenger?.baselinePolicyId)
    : undefined;

  const payload: ConsoleBootstrap = {
    data: buildConsoleData({
      snapshot,
      defense,
      copilotProviderLabel: providerLabel(),
      cases: store.cases,
      caseComments: store.caseComments,
      merchantOverrides: store.merchantOverrides,
      graph: latestGraphSnapshot,
      policy: latestPolicyArtifact,
      baselinePolicy: baselinePolicyArtifact,
      auditEvents: store.auditEvents,
      simulatorRun: latestSimulatorRun,
      agentMemories: store.agentMemories,
      agentApprovalRequests: store.agentApprovalRequests,
      agentTelemetry: store.agentTelemetry,
    }),
    cases: store.cases,
    caseComments: store.caseComments,
    merchantOverrides: store.merchantOverrides,
    latestPolicyArtifact,
    latestGraphSnapshot,
    latestSimulatorRun,
    auditEvents: store.auditEvents,
    agentMemories: store.agentMemories,
    agentApprovalRequests: store.agentApprovalRequests,
    agentTelemetry: store.agentTelemetry,
  };

  if (!options?.bypassCache) {
    await writeCachedJson(cacheKey, payload, CONSOLE_CACHE_TTL_SECONDS);
  }
  return payload;
}

type CopilotContextData = {
  snapshot: ReturnType<typeof getDashboardSnapshot>;
  defense: ReturnType<typeof buildDefenseLabSnapshot>;
  latestPolicyArtifact: PolicyArtifactRecord;
  latestGraphSnapshot: GraphSnapshotRecord;
  cases: ReviewCaseRecord[];
  caseComments: CaseCommentRecord[];
  merchantOverrides: MerchantOverrideRecord[];
  auditEvents: AuditEventRecord[];
  latestSimulatorRun: SimulatorRunRecord;
  agentMemories: AgentMemoryRecord[];
  agentApprovalRequests: AgentApprovalRequestRecord[];
  agentTelemetry: AgentTelemetryRecord[];
};

export async function getCopilotContextData(): Promise<CopilotContextData> {
  const cached = await readCachedJson<CopilotContextData>(copilotCacheKey());
  if (cached) {
    return cached;
  }

  const { snapshot, defense, store } = await ensureOperationalStore();
  const activeReplayCohort = latest(store.simulatorRuns)?.replayCohort ?? "linked_attacks";

  const latestSimulatorRun =
    latest(store.simulatorRuns) ?? buildSimulatorRun(defense.config, activeReplayCohort, store.merchantOverrides);
  const payload: CopilotContextData = {
    snapshot,
    defense,
    latestPolicyArtifact:
      latest(store.policyArtifacts) ??
      buildPolicyArtifact(defense.config, null, activeReplayCohort, store.merchantOverrides),
    latestGraphSnapshot: latest(store.graphSnapshots) ?? buildGraphSnapshot(snapshot.transactions),
    cases: store.cases,
    caseComments: store.caseComments,
    merchantOverrides: store.merchantOverrides,
    auditEvents: store.auditEvents.slice(0, 30),
    latestSimulatorRun,
    agentMemories: store.agentMemories,
    agentApprovalRequests: store.agentApprovalRequests,
    agentTelemetry: store.agentTelemetry,
  };

  await writeCachedJson(copilotCacheKey(), payload, COPILOT_CACHE_TTL_SECONDS);
  return payload;
}

function statusForAction(action: "hold" | "investigate" | "escalate" | "dismiss"): ReviewCaseStatus {
  if (action === "hold") return "held";
  if (action === "investigate") return "investigating";
  if (action === "escalate") return "escalated";
  return "dismissed";
}

function auditTypeForStatus(status: ReviewCaseStatus): AuditEventRecord["type"] {
  if (status === "held") return "case_held";
  if (status === "investigating") return "case_investigating";
  if (status === "escalated") return "case_escalated";
  return "case_dismissed";
}

export async function listCases() {
  const store = await readOpsStore();
  return [...store.cases].sort((left, right) => right.score - left.score);
}

export async function listComments(caseId: string) {
  const store = await readOpsStore();
  return store.caseComments
    .filter((comment) => comment.caseId === caseId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

export async function addCaseComment(input: {
  caseId: string;
  author?: string;
  content: string;
}) {
  const author = input.author?.trim() || DEFAULT_ACTOR;

  return withOpsStore(async (store) => {
    const reviewCase = store.cases.find((item) => item.id === input.caseId);

    if (!reviewCase) {
      throw new Error(`Case ${input.caseId} was not found.`);
    }

    const comment: CaseCommentRecord = {
      id: `comment_${reviewCase.id}_${Date.now()}`,
      caseId: reviewCase.id,
      author,
      content: input.content.trim(),
      createdAt: new Date().toISOString(),
    };

    store.caseComments.push(comment);
    store.auditEvents.unshift({
      id: `audit_comment_${reviewCase.id}_${Date.now()}`,
      caseId: reviewCase.id,
      type: "case_investigating",
      actor: author,
      note: `Comment added: ${comment.content}`,
      createdAt: comment.createdAt,
    });

    await invalidateOperationalCaches();
    return comment;
  });
}

export async function listMerchantOverrides() {
  const store = await readOpsStore();
  return store.merchantOverrides;
}

export async function upsertMerchantOverride(input: {
  merchantId: string;
  merchantName: string;
  strategy: "strict" | "balanced" | "lenient";
}) {
  return withOpsStore(async (store) => {
    const now = new Date().toISOString();
    const profile =
      input.strategy === "strict"
        ? {
            thresholdOffset: -4,
            autoHoldOffset: -3,
            reason: "Tightened merchant pilot for elevated chargeback and retry pressure.",
          }
        : input.strategy === "lenient"
          ? {
              thresholdOffset: 3,
              autoHoldOffset: 2,
              reason: "Relaxed merchant pilot to reduce false-positive review pressure.",
            }
          : {
              thresholdOffset: 0,
              autoHoldOffset: 0,
              reason: "Merchant reset to baseline policy behavior.",
            };

    const existing = store.merchantOverrides.find((override) => override.merchantId === input.merchantId);

    if (existing) {
      existing.strategy = input.strategy;
      existing.thresholdOffset = profile.thresholdOffset;
      existing.autoHoldOffset = profile.autoHoldOffset;
      existing.reason = profile.reason;
      existing.updatedAt = now;
    } else {
      store.merchantOverrides.push({
        merchantId: input.merchantId,
        merchantName: input.merchantName,
        strategy: input.strategy,
        thresholdOffset: profile.thresholdOffset,
        autoHoldOffset: profile.autoHoldOffset,
        reason: profile.reason,
        updatedAt: now,
      });
    }

    const replayCohort = latest(store.simulatorRuns)?.replayCohort ?? "linked_attacks";
    const seededDefense = buildDefenseLabSnapshot({
      ...(latest(store.simulatorRuns)?.config ?? DEFAULT_CONFIG),
      replayCohort,
      merchantOverrides: store.merchantOverrides,
    });
    const defense = await enrichDefenseLabWithAgentReasoning(seededDefense);
    const runtime = refreshAgentRuntime(defense, replayCohort);

    store.agentMemories = runtime.memories;
    store.agentApprovalRequests = runtime.approvals;
    store.agentTelemetry = runtime.telemetry;
    store.auditEvents.unshift({
      id: `audit_override_${input.merchantId}_${Date.now()}`,
      caseId: null,
      type: "policy_evaluated",
      actor: DEFAULT_ACTOR,
      note: `${input.merchantName} moved to ${input.strategy} merchant override.`,
      createdAt: now,
    });

    await invalidateOperationalCaches();
    return store.merchantOverrides.find((override) => override.merchantId === input.merchantId)!;
  });
}

export async function runCaseAction(input: {
  caseId: string;
  action: "hold" | "investigate" | "escalate" | "dismiss";
  note?: string;
  actor?: string;
}) {
  const actor = input.actor?.trim() || DEFAULT_ACTOR;

  return withOpsStore(async (store) => {
    const reviewCase = store.cases.find((item) => item.id === input.caseId);

    if (!reviewCase) {
      throw new Error(`Case ${input.caseId} was not found.`);
    }

    const nextStatus = statusForAction(input.action);
    reviewCase.status = nextStatus;
    reviewCase.updatedAt = new Date().toISOString();

    const auditEvent: AuditEventRecord = {
      id: `audit_${reviewCase.id}_${Date.now()}`,
      caseId: reviewCase.id,
      type: auditTypeForStatus(nextStatus),
      actor,
      note: input.note?.trim() || `${reviewCase.transactionId} moved to ${nextStatus} by ${actor}.`,
      createdAt: reviewCase.updatedAt,
      metadata: {
        merchant: reviewCase.merchantName,
        status: nextStatus,
      },
    };

    store.auditEvents.unshift(auditEvent);
    await invalidateOperationalCaches();
    return { reviewCase, auditEvent };
  });
}

export async function saveSimulatorRun(
  config: Partial<DefenseLabConfig> & { replayCohort?: ReplayCohort },
) {
  const currentStore = await readOpsStore();
  const replayCohort = config.replayCohort ?? latest(currentStore.simulatorRuns)?.replayCohort ?? "linked_attacks";
  const nextDefense = buildDefenseLabSnapshot({
    ...config,
    replayCohort,
    merchantOverrides: currentStore.merchantOverrides,
  });
  const defense = await enrichDefenseLabWithAgentReasoning(nextDefense);
  const baseline = latest(currentStore.policyArtifacts) ?? null;
  const nextPolicyArtifact = buildPolicyArtifact(
    defense.config,
    baseline,
    replayCohort,
    currentStore.merchantOverrides,
  );
  const nextSimulatorRun = buildSimulatorRun(defense.config, replayCohort, currentStore.merchantOverrides, []);
  const runtime = refreshAgentRuntime(defense, replayCohort);

  await withOpsStore(async (store) => {
    store.policyArtifacts = [
      nextPolicyArtifact,
      ...store.policyArtifacts.filter((artifact) => artifact.id !== nextPolicyArtifact.id),
    ].slice(0, 12);
    store.simulatorRuns = [
      nextSimulatorRun,
      ...store.simulatorRuns.filter((run) => run.id !== nextSimulatorRun.id),
    ].slice(0, 12);
    store.agentMemories = runtime.memories;
    store.agentApprovalRequests = runtime.approvals;
    store.agentTelemetry = runtime.telemetry;
    store.auditEvents.unshift({
      id: `audit_sim_${Date.now()}`,
      caseId: null,
      type: "simulator_run_saved",
      actor: DEFAULT_ACTOR,
      note: `${replayCohort.replaceAll("_", " ")} replay saved at threshold ${defense.config.threshold}, auto-hold ${defense.config.autoHoldThreshold}, capacity ${defense.config.analystCapacity}.`,
      createdAt: new Date().toISOString(),
    });

    await invalidateOperationalCaches();
  });

  return getConsoleBootstrap({ ...defense.config, replayCohort });
}

export async function appendSimulatorIntervention(input: {
  tick: number;
  actor?: string;
  targetType: "merchant" | "cluster" | "payment" | "policy";
  targetId: string;
  targetLabel: string;
  action: string;
  nextConfig?: Partial<DefenseLabConfig>;
  nextReplayCohort?: ReplayCohort;
  merchantOverride?: {
    merchantId: string;
    merchantName: string;
    strategy: "strict" | "balanced" | "lenient";
  };
  effect: string;
}) {
  const actor = input.actor?.trim() || DEFAULT_ACTOR;
  const currentStore = await readOpsStore();
  const latestRun = latest(currentStore.simulatorRuns);
  const replayCohort = input.nextReplayCohort ?? latestRun?.replayCohort ?? "linked_attacks";
  const config = {
    ...(latestRun?.config ?? DEFAULT_CONFIG),
    ...(input.nextConfig ?? {}),
  };

  const nextOverrides = [...currentStore.merchantOverrides];

  if (input.merchantOverride) {
    const profile =
      input.merchantOverride.strategy === "strict"
        ? {
            thresholdOffset: -4,
            autoHoldOffset: -3,
            reason: "Tightened merchant pilot for elevated chargeback and retry pressure.",
          }
        : input.merchantOverride.strategy === "lenient"
          ? {
              thresholdOffset: 3,
              autoHoldOffset: 2,
              reason: "Relaxed merchant pilot to reduce false-positive review pressure.",
            }
          : {
              thresholdOffset: 0,
              autoHoldOffset: 0,
              reason: "Merchant reset to baseline policy behavior.",
            };

    const existing = nextOverrides.find((override) => override.merchantId === input.merchantOverride?.merchantId);
    const updatedAt = new Date().toISOString();

    if (existing) {
      existing.strategy = input.merchantOverride.strategy;
      existing.thresholdOffset = profile.thresholdOffset;
      existing.autoHoldOffset = profile.autoHoldOffset;
      existing.reason = profile.reason;
      existing.updatedAt = updatedAt;
    } else {
      nextOverrides.push({
        merchantId: input.merchantOverride.merchantId,
        merchantName: input.merchantOverride.merchantName,
        strategy: input.merchantOverride.strategy,
        thresholdOffset: profile.thresholdOffset,
        autoHoldOffset: profile.autoHoldOffset,
        reason: profile.reason,
        updatedAt,
      });
    }
  }

  const intervention: SimulatorInterventionRecord = {
    id: `sim_event_${Date.now()}`,
    tick: input.tick,
    actor,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    action: input.action,
    effect: input.effect,
    createdAt: new Date().toISOString(),
  };

  const nextDefense = buildDefenseLabSnapshot({
    ...config,
    replayCohort,
    merchantOverrides: nextOverrides,
  });
  const defense = await enrichDefenseLabWithAgentReasoning(nextDefense);
  const baseline = latest(currentStore.policyArtifacts) ?? null;
  const nextPolicyArtifact = buildPolicyArtifact(defense.config, baseline, replayCohort, nextOverrides);
  const nextSimulatorRun = buildSimulatorRun(
    defense.config,
    replayCohort,
    nextOverrides,
    [...(latestRun?.interventions ?? []), intervention],
  );
  const runtime = refreshAgentRuntime(defense, replayCohort, currentStore.agentApprovalRequests);

  await withOpsStore(async (store) => {
    store.merchantOverrides = nextOverrides;
    store.policyArtifacts = [
      nextPolicyArtifact,
      ...store.policyArtifacts.filter((artifact) => artifact.id !== nextPolicyArtifact.id),
    ].slice(0, 12);
    store.simulatorRuns = [
      nextSimulatorRun,
      ...store.simulatorRuns.filter((run) => run.id !== nextSimulatorRun.id),
    ].slice(0, 12);
    store.agentMemories = runtime.memories;
    store.agentApprovalRequests = runtime.approvals;
    store.agentTelemetry = runtime.telemetry;
    store.auditEvents.unshift({
      id: `audit_sim_intervention_${Date.now()}`,
      caseId: null,
      type: "simulator_run_saved",
      actor,
      note: `Tick ${input.tick}: ${input.targetLabel} -> ${input.action}. ${input.effect}`,
      createdAt: intervention.createdAt,
    });

    await invalidateOperationalCaches();
  });

  return getConsoleBootstrap({ ...defense.config, replayCohort });
}

export async function refreshGraphSnapshot() {
  const snapshot = getDashboardSnapshot();
  const graph = buildGraphSnapshot(snapshot.transactions);

  await withOpsStore(async (store) => {
    store.graphSnapshots = [graph, ...store.graphSnapshots.filter((entry) => entry.id !== graph.id)].slice(0, 10);
    store.auditEvents.unshift({
      id: `audit_graph_${Date.now()}`,
      caseId: null,
      type: "graph_refreshed",
      actor: DEFAULT_ACTOR,
      note: `Graph intelligence refreshed with ${graph.clusters.length} suspicious clusters.`,
      createdAt: new Date().toISOString(),
    });

    await invalidateOperationalCaches();
  });

  return graph;
}

export async function evaluatePolicy(
  config: Partial<DefenseLabConfig> & { replayCohort?: ReplayCohort },
) {
  const currentStore = await readOpsStore();
  const replayCohort = config.replayCohort ?? latest(currentStore.simulatorRuns)?.replayCohort ?? "linked_attacks";
  const defense = buildDefenseLabSnapshot({
    ...config,
    replayCohort,
    merchantOverrides: currentStore.merchantOverrides,
  });
  const enrichedDefense = await enrichDefenseLabWithAgentReasoning(defense);
  const baseline = latest(currentStore.policyArtifacts) ?? null;
  const artifact = buildPolicyArtifact(
    enrichedDefense.config,
    baseline,
    replayCohort,
    currentStore.merchantOverrides,
  );
  const runtime = refreshAgentRuntime(enrichedDefense, replayCohort, currentStore.agentApprovalRequests);

  await withOpsStore(async (store) => {
    store.policyArtifacts = [
      artifact,
      ...store.policyArtifacts.filter((entry) => entry.id !== artifact.id),
    ].slice(0, 12);
    store.agentMemories = runtime.memories;
    store.agentApprovalRequests = runtime.approvals;
    store.agentTelemetry = runtime.telemetry;
    store.auditEvents.unshift({
      id: `audit_policy_${Date.now()}`,
      caseId: null,
      type: "policy_evaluated",
      actor: DEFAULT_ACTOR,
      note: `Policy evaluated at threshold ${artifact.config.threshold} with ${Math.round(artifact.precision * 100)}% precision and ${Math.round(artifact.recall * 100)}% recall.`,
      createdAt: artifact.generatedAt,
    });

    await invalidateOperationalCaches();
  });

  return artifact;
}

export async function resolveAgentApproval(input: {
  approvalId: string;
  status: "approved" | "rejected";
  actor?: string;
  note?: string;
}) {
  const actor = input.actor?.trim() || DEFAULT_ACTOR;

  return withOpsStore(async (store) => {
    const approval = store.agentApprovalRequests.find((entry) => entry.id === input.approvalId);

    if (!approval) {
      throw new Error(`Approval ${input.approvalId} was not found.`);
    }

    approval.status = input.status;
    approval.resolvedAt = new Date().toISOString();
    approval.resolvedBy = actor;
    approval.resolutionNote =
      input.note?.trim() ||
      (input.status === "approved"
        ? "Approved in simulator operations dock."
        : "Rejected in simulator operations dock.");

    store.auditEvents.unshift({
      id: `audit_approval_${approval.id}_${Date.now()}`,
      caseId: null,
      type: "simulator_run_saved",
      actor,
      note: `${approval.targetLabel} ${approval.action} was ${input.status}.`,
      createdAt: approval.resolvedAt,
      metadata: {
        approvalId: approval.id,
        status: approval.status,
      },
    });

    await invalidateOperationalCaches();
    return approval;
  });
}
