import "server-only";

import { areOperationsHalted } from "@/lib/server/operations-control";

export type LlmProvider = "groq" | "gemini" | "openrouter" | "local";

export type LlmCompletionInput = {
  provider: LlmProvider;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  apiKeyOverride?: string | null;
  allowDuringHalt?: boolean;
};

export type LlmCompletionResult = {
  text: string | null;
  provider: LlmProvider;
  model: string;
  live: boolean;
};

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  groq: "Groq",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  local: "Local",
};

export function providerLabel(provider: LlmProvider) {
  return PROVIDER_LABELS[provider];
}

function extractOpenAiText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const choices = (body as { choices?: Array<{ message?: { content?: string } }> }).choices;
  return choices?.[0]?.message?.content?.trim() || null;
}

function extractGeminiText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const candidates = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  return (
    parts
      .map((part) => part.text?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .trim() || null
  );
}

async function requestOpenAiCompatible(
  provider: "groq" | "openrouter",
  apiKey: string,
  input: LlmCompletionInput,
) {
  const endpoint =
    provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME || "Sentinel AI Risk Console";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.model,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 280,
      messages: [
        ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
        { role: "user", content: input.userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`${provider} request failed with ${response.status}`);
  }

  return extractOpenAiText(await response.json());
}

async function requestGemini(apiKey: string, input: LlmCompletionInput) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${input.systemPrompt ? `${input.systemPrompt}\n\n` : ""}${input.userPrompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: input.temperature ?? 0.2,
          maxOutputTokens: input.maxTokens ?? 280,
        },
      }),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    throw new Error(`gemini request failed with ${response.status}`);
  }

  return extractGeminiText(await response.json());
}

export async function completeText(input: LlmCompletionInput): Promise<LlmCompletionResult> {
  const blockedByHalt = !input.allowDuringHalt && (await areOperationsHalted());

  if (input.provider === "local" || blockedByHalt) {
    return {
      text: null,
      provider: input.provider,
      model: input.model,
      live: false,
    };
  }

  const apiKey = input.apiKeyOverride?.trim();
  if (!apiKey) {
    return {
      text: null,
      provider: input.provider,
      model: input.model,
      live: false,
    };
  }

  try {
    const text =
      input.provider === "gemini"
        ? await requestGemini(apiKey, input)
        : await requestOpenAiCompatible(input.provider, apiKey, input);

    return {
      text,
      provider: input.provider,
      model: input.model,
      live: Boolean(text),
    };
  } catch {
    return {
      text: null,
      provider: input.provider,
      model: input.model,
      live: false,
    };
  }
}
