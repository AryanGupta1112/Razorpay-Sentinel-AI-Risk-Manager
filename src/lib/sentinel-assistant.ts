import { getCopilotContextData } from "@/lib/server/ops-service";
import { getCopilotLlmConfig } from "@/lib/agent-llm";
import { completeText } from "@/lib/llm";
import { areOperationsHalted } from "@/lib/server/operations-control";

type SentinelResponse = {
  answer: string;
  source: "groq" | "gemini" | "openrouter" | "local";
};

type SentinelMessage = {
  role: "user" | "assistant";
  content: string;
};

function isGreetingOnly(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  return ["hi", "hello", "hey", "yo", "hola", "sup"].includes(normalized);
}

function buildGreetingAnswer(): string {
  return "Ready. Ask what is happening now, why a payment was flagged, what the agents recommend, or how any Sentinel screen works.";
}

const PROJECT_GUIDE = {
  product: "Sentinel is a payment-risk operations workspace. It generates a realistic live payment stream, finds suspicious behavior, groups connected activity, and gives human reviewers final control over important actions.",
  data: "Because no external payment processor is connected, the ingestion service continuously creates varied businesses, customers, devices, payments, and risk situations. The data is simulated, not a claim about real customers.",
  screens: {
    overview: "A plain summary of risk, review workload, detection quality, cases, and system health.",
    sentinel: "An always-available assistant that explains the product and current operational state in plain language.",
    alerts: "Payments that need attention, why they were flagged, and the next suggested action.",
    businesses: "Business risk, payment volume, alerts, and business-specific review rules.",
    payments: "The latest payment stream, outcomes, risk scores, methods, devices, and timestamps.",
    simulator: "A visual map showing how businesses, customers, payments, patterns, and review controls are connected over time.",
    controlRoom: "A shared workspace where Signal Scout, Merchant Guard, Policy Guard, and Queue Ops compare evidence and present one team recommendation for human approval.",
    accounts: "Platform administrators can create and update users, roles, verification state, passwords, and business access.",
  },
  agents: {
    signalScout: "Finds unusual payment and device patterns.",
    merchantGuard: "Checks whether behavior is unusual for the affected business.",
    policyGuard: "Checks the decision against current rules and estimates the cost of mistakes.",
    queueOps: "Tracks review workload and routes urgent work so the queue keeps moving.",
  },
  controls: "Continue lets ingestion, simulation, agents, and operational API work proceed. Halt freezes those operations across the site and keeps that state across refreshes. Sentinel chat intentionally remains available while halted.",
  roles: "Platform Admin manages the whole workspace. Risk Lead supervises risk decisions. Fraud Ops Analyst reviews payments and cases. Merchant Risk Analyst can only work with assigned businesses.",
} as const;

async function buildLocalAnswer(question: string): Promise<string> {
  if (isGreetingOnly(question)) {
    return buildGreetingAnswer();
  }

  const context = await getCopilotContextData();
  const snapshot = context.snapshot;
  const worstMerchant = snapshot.merchants[0];
  const topAlert = snapshot.alerts[0];
  const latestPolicy = context.latestPolicyArtifact;
  const topCluster = context.latestGraphSnapshot.clusters[0];
  const normalized = question.toLowerCase();
  const operationsHalted = await areOperationsHalted();
  const latestFrame = context.defense.frames.at(-1);
  const latestAction = context.defense.agentActions.at(-1);

  if (normalized.includes("what is sentinel") || normalized.includes("project") || normalized.includes("screen") || normalized.includes("feature")) {
    return `${PROJECT_GUIDE.product} The main screens are Overview, Alerts, Businesses, Payments, Simulator, Control Room, and Sentinel chat. ${PROJECT_GUIDE.data} Right now operations are ${operationsHalted ? "halted" : "continuing"}, ${snapshot.alerts.length} payments need review, and the simulator is at step ${latestFrame?.tick ?? 0}. ${latestFrame ? `${latestFrame.headline}: ${latestFrame.subline}` : "The simulator has not produced a step yet."} ${latestAction ? `Latest agent update: ${latestAction.agentName} recommends ${latestAction.action.toLowerCase()}.` : "The agents have no new recommendation yet."}`;
  }

  if (normalized.includes("agent") || normalized.includes("control room") || normalized.includes("team")) {
    return `The four-agent team watches patterns, business behavior, decision rules, and review workload. Operations are ${operationsHalted ? "halted" : "continuing"}. ${latestAction ? `The latest recorded action is ${latestAction.agentName}: ${latestAction.action}. ${latestAction.reasoning}` : "There is no new agent action yet."}`;
  }

  if (normalized.includes("halt") || normalized.includes("continue") || normalized.includes("stop")) {
    return PROJECT_GUIDE.controls;
  }

  if (normalized.includes("merchant") || normalized.includes("who")) {
    return `${worstMerchant.name} is the highest-priority merchant right now. Its health score is ${worstMerchant.healthScore}, it has ${worstMerchant.flaggedTransactions} flagged transactions, and the dominant risk is ${worstMerchant.dominantRisk.toLowerCase()}.`;
  }

  if (normalized.includes("threshold") || normalized.includes("policy") || normalized.includes("simulate") || normalized.includes("precision")) {
    return `The current rules send payments for review at risk score ${latestPolicy.config.threshold} and automatically hold them at ${latestPolicy.config.autoHoldThreshold}. Of blocked payments, ${Math.round(latestPolicy.precision * 100)}% were risky; the rules found ${Math.round(latestPolicy.recall * 100)}% of likely fraud; and ${Math.round(latestPolicy.falsePositiveRate * 100)}% of reviewed payments were probably safe. Recommendation: ${latestPolicy.recommendation}`;
  }

  if (normalized.includes("cluster") || normalized.includes("graph") || normalized.includes("ring")) {
    return `${topCluster.label} is the strongest linked pattern right now. It spans ${topCluster.transactionIds.length} risky payments across ${topCluster.merchantIds.length} merchants and ${topCluster.customerIds.length} linked customers. ${topCluster.summary}`;
  }

  return `Top risk cluster: ${topAlert.merchantName} on ${topAlert.id}. The strongest triggers are ${topAlert.triggers
    .slice(0, 2)
    .map((trigger) => trigger.label.toLowerCase())
    .join(" and ")}. Recommended action: ${topAlert.recommendation.toLowerCase()}`;
}

export async function getSentinelAnswerWithHistory(
  history: SentinelMessage[],
): Promise<SentinelResponse> {
  const config = getCopilotLlmConfig();
  const lastUserMessage =
    [...history].reverse().find((message) => message.role === "user")?.content?.trim() ||
    "Summarize the current highest-risk cluster.";

  if (isGreetingOnly(lastUserMessage)) {
    return { answer: buildGreetingAnswer(), source: config.live ? config.provider : "local" };
  }

  if (!config.live) {
    return { answer: await buildLocalAnswer(lastUserMessage), source: "local" };
  }

  const opsContext = await getCopilotContextData();
  const operationsHalted = await areOperationsHalted();
  const latestFrame = opsContext.defense.frames.at(-1);
  const context = {
    projectGuide: PROJECT_GUIDE,
    liveState: {
      generatedAt: opsContext.snapshot.generatedAt,
      operationsMode: operationsHalted ? "halted" : "continuing",
      currentSimulatorStep: latestFrame?.tick ?? 0,
      currentSimulatorSummary: latestFrame
        ? `${latestFrame.headline}. ${latestFrame.subline}`
        : opsContext.defense.summary.subtitle,
      currentAgentActions: opsContext.defense.agentActions.slice(-12),
      latestSimulatorRun: opsContext.latestSimulatorRun,
      pendingAgentApprovals: opsContext.agentApprovalRequests.filter((approval) => approval.status === "pending"),
      agentPerformance: opsContext.agentTelemetry,
      recentAgentMemory: opsContext.agentMemories.slice(0, 12),
    },
    overview: opsContext.snapshot.overview,
    currentAlerts: opsContext.snapshot.alerts.slice(0, 40),
    businesses: opsContext.snapshot.merchants,
    recentPayments: opsContext.snapshot.transactions.slice(0, 60),
    linkedPatterns: opsContext.latestGraphSnapshot.clusters,
    currentPolicy: opsContext.latestPolicyArtifact,
    reviewCases: opsContext.cases.slice(0, 50),
    caseComments: opsContext.caseComments.slice(0, 30),
    businessSpecificRules: opsContext.merchantOverrides,
    recentAudit: opsContext.auditEvents,
  };

  try {
    const response = await completeText({
      provider: config.provider,
      model: config.model,
      temperature: 0.2,
      maxTokens: 900,
      apiKeyOverride: config.apiKeyOverride,
      allowDuringHalt: true,
      systemPrompt:
        "You are Sentinel, the always-available guide for this payment-risk workspace. Use the supplied project guide for product questions and the live snapshot for what is happening now across every screen and the Control Room. Explain everything in everyday language by default. If a technical term is necessary, define it immediately. Never invent an external integration or claim simulated data is real. Distinguish facts from recommendations, quote exact payment or business IDs when useful, and mention when operations are halted. Be concise, direct, and actionable. Use short headings only when they improve readability. Do not use greetings, emojis, hype, or filler.",
      userPrompt: `Context:\n${JSON.stringify(context)}\n\nConversation:\n${history
        .slice(-8)
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n")}`,
    });
    const answer = response.text?.trim();

    return {
      answer: answer || (await buildLocalAnswer(lastUserMessage)),
      source: answer ? config.provider : "local",
    };
  } catch {
    return { answer: await buildLocalAnswer(lastUserMessage), source: "local" };
  }
}
