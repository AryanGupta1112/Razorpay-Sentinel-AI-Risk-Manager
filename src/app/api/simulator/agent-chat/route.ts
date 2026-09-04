import { NextRequest, NextResponse } from "next/server";
import { getAgentLlmConfig } from "@/lib/agent-llm";
import { completeText } from "@/lib/llm";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { authErrorResponse } from "@/lib/server/auth-route";
import { getConsoleBootstrap } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";
import type { DefenseAgentRole } from "@/types/risk";

const AGENT_ROLES: Record<string, DefenseAgentRole> = {
  agent_signal_scout: "signal_scout",
  agent_merchant_guard: "merchant_guard",
  agent_policy_guard: "policy_guard",
  agent_queue_ops: "queue_coordinator",
};

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

function isGreetingOnly(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
  return /^(hi|hello|hey|good morning|good afternoon|good evening)( there)?$/.test(normalized);
}

function finishAgentReply(value: string, maxWords = 100) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const words = normalized.split(" ");
  const capped = words.slice(0, maxWords).join(" ");
  const needsCleanEnding = words.length > maxWords || !/[.!?]$/.test(capped);

  if (!needsCleanEnding) return capped;

  const sentenceEnds = [...capped.matchAll(/[.!?](?=\s|$)/g)];
  const lastSentenceEnd = sentenceEnds.at(-1)?.index;
  if (typeof lastSentenceEnd === "number" && lastSentenceEnd >= Math.min(40, capped.length / 2)) {
    return capped.slice(0, lastSentenceEnd + 1);
  }

  return `${capped.replace(/[,:;\s-]+$/, "")}.`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "view_control_room");
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;

    const body = (await request.json()) as {
      agentId?: string;
      message?: string;
      tick?: number;
      history?: ConversationMessage[];
    };
    const agentId = body.agentId?.trim() ?? "";
    const message = body.message?.trim() ?? "";
    const role = AGENT_ROLES[agentId];

    if (!role || !message || message.length > 1_500) {
      return NextResponse.json(
        { error: "Choose an agent and send a message under 1,500 characters." },
        { status: 400 },
      );
    }

    const { data } = await getConsoleBootstrap(undefined, {
      bypassCache: false,
      enrichAgentReasoning: false,
    });
    const agent = data.simulator.agentRoster.find((entry) => entry.id === agentId);
    if (!agent) {
      return NextResponse.json({ error: "That agent is not available." }, { status: 404 });
    }

    if (isGreetingOnly(message)) {
      return NextResponse.json({
        answer: `Hi. I am ${agent.name}. What would you like to know about my current work?`,
        source: "local",
        agentId,
      });
    }

    const frame =
      data.simulator.frames.find((entry) => entry.tick === body.tick) ??
      data.simulator.frames.at(-1) ??
      null;
    const action = frame?.agentActions.find((entry) => entry.agentName === agent.name) ?? null;
    const discussion =
      data.simulator.deliberations.find((entry) => entry.tick === frame?.tick) ??
      data.simulator.deliberations.at(-1) ??
      null;
    const pendingDecisions = data.simulator.deliberations
      .filter((entry) => entry.consensus.status === "pending")
      .slice(-4)
      .map((entry) => ({
        title: entry.title,
        merchant: entry.merchantName,
        payment: entry.transactionId,
        amount: entry.amount,
        recommendation: entry.consensus.action,
        reason: entry.consensus.rationale,
        agreement: `${entry.consensus.votes}/4`,
      }));
    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (entry): entry is ConversationMessage =>
              (entry?.role === "user" || entry?.role === "assistant") &&
              typeof entry.content === "string" &&
              Boolean(entry.content.trim()),
          )
          .slice(-10)
      : [];
    const config = getAgentLlmConfig(role);
    const response = await completeText({
      provider: config.provider,
      model: config.model,
      apiKeyOverride: config.apiKeyOverride,
      temperature: 0.25,
      maxTokens: 240,
      systemPrompt: `You are ${agent.name}, the ${agent.role} in Sentinel's payment-risk Control Room. ${agent.mission} The administrator is speaking directly to you while you work. Answer only what the administrator asked, as this agent, in clear everyday language. Use the supplied live context as truth, but do not dump unrelated board information. Explain what you see, what it means, and what you recommend only when relevant to the question. If information is missing, say so. Do not claim simulated data is from a real external payment system. Do not speak for another agent or approve a team decision yourself. Keep every reply under 90 words. Use no more than four short sentences and always finish the final sentence.`,
      userPrompt: `Live context:\n${JSON.stringify({
        update: frame?.tick ?? null,
        currentSituation: frame ? { headline: frame.headline, summary: frame.subline } : null,
        yourCurrentWork: action,
        teamDiscussion: discussion
          ? {
              title: discussion.title,
              merchant: discussion.merchantName,
              payment: discussion.transactionId,
              amount: discussion.amount,
              riskScore: discussion.riskScore,
              messages: discussion.messages.slice(-8),
              teamDecision: discussion.consensus,
            }
          : null,
        pendingDecisions,
      })}\n\nConversation so far:\n${history
        .map((entry) => `${entry.role === "user" ? "ADMIN" : agent.name.toUpperCase()}: ${entry.content}`)
        .join("\n")}\n\nADMIN: ${message}`,
    });

    const fallback = action
      ? `I am currently ${action.action.toLowerCase()}. ${action.reasoning} My confidence is ${Math.round(action.confidence * 100)}%.`
      : `I am watching the current payment flow. I do not have a new action to report yet, but I will explain the next change when it appears.`;

    return NextResponse.json({
      answer: response.text ? finishAgentReply(response.text) : fallback,
      source: response.live ? config.provider : "local",
      agentId,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
