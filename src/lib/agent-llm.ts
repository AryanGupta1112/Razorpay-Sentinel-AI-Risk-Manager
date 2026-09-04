import "server-only";

import { createHash } from "node:crypto";
import { completeText, providerLabel, type LlmProvider } from "@/lib/llm";
import type { DefenseAgent, DefenseAgentAction, DefenseAgentRole, DefenseLabSnapshot } from "@/types/risk";

type AgentLlmConfig = {
  provider: LlmProvider;
  model: string;
  live: boolean;
  label: string;
  apiKeyOverride?: string | null;
};

const DEFAULT_ROLE_MODELS: Record<
  DefenseAgentRole,
  { provider: LlmProvider; model: string; envPrefix: string }
> = {
  signal_scout: {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    envPrefix: "AGENT_SIGNAL_SCOUT",
  },
  merchant_guard: {
    provider: "groq",
    model: "openai/gpt-oss-20b",
    envPrefix: "AGENT_MERCHANT_GUARD",
  },
  policy_guard: {
    provider: "openrouter",
    model: "openrouter/auto",
    envPrefix: "AGENT_POLICY_GUARD",
  },
  queue_coordinator: {
    provider: "openrouter",
    model: "openrouter/auto",
    envPrefix: "AGENT_QUEUE_COORDINATOR",
  },
};

const agentReasoningCache = new Map<string, string>();

function parseProvider(value: string | null | undefined): LlmProvider | null {
  if (!value) return null;
  if (value === "groq" || value === "gemini" || value === "openrouter" || value === "local") {
    return value;
  }
  return null;
}

function buildLabel(provider: LlmProvider, model: string, live: boolean) {
  return `${providerLabel(provider)} · ${model} · ${live ? "live" : "fallback"}`;
}

function readEnvConfig(prefix: string, fallbackProvider: LlmProvider, fallbackModel: string): AgentLlmConfig {
  const provider = parseProvider(process.env[`${prefix}_PROVIDER`]) ?? fallbackProvider;
  const model = process.env[`${prefix}_MODEL`]?.trim() || fallbackModel;
  const apiKeyOverride = process.env[`${prefix}_API_KEY`]?.trim() || null;
  const live = provider !== "local" && Boolean(apiKeyOverride);

  return {
    provider,
    model,
    live,
    label: buildLabel(provider, model, live),
    apiKeyOverride,
  };
}

export function getAgentLlmConfig(role: DefenseAgentRole): AgentLlmConfig {
  const defaults = DEFAULT_ROLE_MODELS[role];
  return readEnvConfig(defaults.envPrefix, defaults.provider, defaults.model);
}

export function getCopilotLlmConfig(): AgentLlmConfig {
  const provider = parseProvider(process.env.SENTINEL_LLM_PROVIDER) ?? "groq";
  const model = process.env.SENTINEL_LLM_MODEL?.trim() || "openai/gpt-oss-20b";
  const apiKeyOverride = process.env.SENTINEL_API_KEY?.trim() || null;
  const live = provider !== "local" && Boolean(apiKeyOverride);

  return {
    provider,
    model,
    live,
    label: buildLabel(provider, model, live),
    apiKeyOverride,
  };
}

export function getCopilotProviderLabel() {
  return getCopilotLlmConfig().label;
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseRewritePayload(
  raw: string,
): { updates?: Array<{ id?: string; reasoning?: string }> } | null {
  try {
    return JSON.parse(stripCodeFence(raw)) as { updates?: Array<{ id?: string; reasoning?: string }> };
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as {
        updates?: Array<{ id?: string; reasoning?: string }>;
      };
    } catch {
      return null;
    }
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneAction(action: DefenseAgentAction, updates: Map<string, string>) {
  const reasoning = updates.get(action.id);
  return reasoning ? { ...action, reasoning } : action;
}

async function rewriteAgentActions(
  agent: DefenseAgent,
  actions: DefenseAgentAction[],
  defense: DefenseLabSnapshot,
): Promise<Map<string, string>> {
  const config = getAgentLlmConfig(agent.role);
  if (!config.live || actions.length === 0) {
    return new Map<string, string>();
  }

  const cacheKey = digest(
    JSON.stringify({
      provider: config.provider,
      model: config.model,
      agentId: agent.id,
      summary: defense.summary,
      actions: actions.map((action) => ({
        id: action.id,
        tick: action.tick,
        targetType: action.targetType,
        targetLabel: action.targetLabel,
        action: action.action,
        reasoning: action.reasoning,
        confidence: action.confidence,
      })),
    }),
  );

  const cached = agentReasoningCache.get(cacheKey);
  if (cached) {
    const parsed = parseRewritePayload(cached);
    const updates = new Map<string, string>();
    parsed?.updates?.forEach((entry) => {
      if (entry.id && entry.reasoning) {
        updates.set(entry.id, entry.reasoning.trim());
      }
    });
    return updates;
  }

  const payload = {
    replayTitle: defense.summary.title,
    replayRecommendation: defense.summary.recommendation,
    measurableOutcome: defense.summary.measurableOutcome,
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      mission: agent.mission,
    },
    actions: actions.map((action) => ({
      id: action.id,
      tick: action.tick,
      targetType: action.targetType,
      targetLabel: action.targetLabel,
      action: action.action,
      confidence: action.confidence,
      seededReasoning: action.reasoning,
      event: defense.events.find((item) => item.tick === action.tick)?.summary ?? null,
    })),
  };

  const response = await completeText({
    provider: config.provider,
    model: config.model,
    temperature: 0.1,
    maxTokens: 700,
    apiKeyOverride: config.apiKeyOverride,
    systemPrompt:
      'You are a defense-only payments risk agent inside a simulator. Return valid JSON only with this shape: {"updates":[{"id":"string","reasoning":"string"}]}. Rewrite each reasoning line to sound sharper and more operational. Keep each reasoning under 180 characters. No markdown. No greetings. No extra keys.',
    userPrompt: JSON.stringify(payload),
  });

  const parsed = response.text ? parseRewritePayload(response.text) : null;
  const updates = new Map<string, string>();
  parsed?.updates?.forEach((entry) => {
    if (entry.id && entry.reasoning) {
      updates.set(entry.id, entry.reasoning.trim());
    }
  });

  if (response.text) {
    agentReasoningCache.set(cacheKey, response.text);
  }

  return updates;
}

export async function enrichDefenseLabWithAgentReasoning(
  defense: DefenseLabSnapshot,
): Promise<DefenseLabSnapshot> {
  const grouped = defense.agentActions.reduce(
    (accumulator, action) => {
      const current = accumulator.get(action.agentId) ?? [];
      current.push(action);
      accumulator.set(action.agentId, current);
      return accumulator;
    },
    new Map<string, DefenseAgentAction[]>(),
  );

  const updates = new Map<string, string>();

  await Promise.all(
    defense.agentRoster.map(async (agent) => {
      const agentUpdates = await rewriteAgentActions(agent, grouped.get(agent.id) ?? [], defense);
      agentUpdates.forEach((reasoning, id) => {
        updates.set(id, reasoning);
      });
    }),
  );

  return {
    ...defense,
    agentRoster: defense.agentRoster.map((agent) => {
      const config = getAgentLlmConfig(agent.role);
      return {
        ...agent,
        llmProvider: config.provider,
        llmModel: config.model,
        llmLabel: config.label,
      };
    }),
    agentActions: defense.agentActions.map((action) => cloneAction(action, updates)),
    events: defense.events.map((event) => ({
      ...event,
      agentActions: event.agentActions.map((action) => cloneAction(action, updates)),
    })),
    frames: defense.frames.map((frame) => ({
      ...frame,
      agentActions: frame.agentActions.map((action) => cloneAction(action, updates)),
    })),
  };
}
