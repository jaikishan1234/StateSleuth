/**
 * Multi-provider model configuration.
 *
 * Server-only: reads credentials from the environment. Never import this from a
 * client component, and never include an API key in an error, log line or API
 * response.
 *
 * Supported providers speak the OpenAI chat-completions dialect. Gemini uses
 * its OpenAI-compatible endpoint, so all three share one transport shape.
 */

export const PROVIDER_IDS = ["gemini", "groq", "openrouter"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type AgentName = "planner" | "coding";

export const DEFAULT_PROVIDER: ProviderId = "gemini";

/**
 * Output-token budgets, per agent.
 *
 * A plan is a short structured document; a unified diff can be long. The two
 * agents are configured independently, so their budgets are independent too.
 * Override with PLANNER_MAX_OUTPUT_TOKENS / CODING_MAX_OUTPUT_TOKENS.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS: Record<AgentName, number> = {
  planner: 1_600,
  coding: 4_000,
};

/** Accepted range for a configured output budget. */
export const OUTPUT_TOKEN_LIMITS = { min: 256, max: 16_000 } as const;

/**
 * Request deadlines, per agent.
 *
 * The whole deadline covers receiving response headers and reading the body.
 * Only the planner is configurable (PLANNER_TIMEOUT_MS); the coding agent keeps
 * the 45 s it has always used.
 */
export const DEFAULT_TIMEOUT_MS: Record<AgentName, number> = {
  planner: 90_000,
  coding: 45_000,
};

/** Accepted range for PLANNER_TIMEOUT_MS. */
export const TIMEOUT_LIMITS = { min: 5_000, max: 300_000 } as const;

export type ProviderDefaults = {
  baseUrl: string;
  model: string;
  /** Provider-wide key variables, checked after the agent-specific key. */
  keyEnv: readonly string[];
};

/**
 * Defaults chosen to keep the existing Gemini setup working: the same endpoint
 * and model the project already used through PLANNER_BASE_URL / PLANNER_MODEL.
 */
export const PROVIDER_DEFAULTS: Record<ProviderId, ProviderDefaults> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    keyEnv: ["GEMINI_API_KEY"],
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyEnv: ["GROQ_API_KEY"],
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    keyEnv: ["OPENROUTER_API_KEY"],
  },
};

export type ProviderErrorCode =
  | "invalid_provider"
  | "missing_credentials"
  | "invalid_base_url"
  | "invalid_model"
  | "invalid_output_limit"
  | "invalid_timeout"
  | "auth"
  | "not_found"
  | "rate_limit"
  | "unavailable"
  | "timeout"
  | "truncated"
  | "bad_response"
  | "request_failed";

/** A safe, user-facing provider error. The message never contains a key. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export type ResolvedProvider = {
  agent: AgentName;
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKey?: string;
  configured: boolean;
  providerHost: string;
  /**
   * Output-token budget for this agent. Optional so a hand-built config still
   * type-checks; `buildChatRequest` then falls back to the agent default.
   */
  maxOutputTokens?: number;
  /**
   * Whole-request deadline in milliseconds, covering headers and body. Optional
   * so a hand-built config still type-checks; the transport falls back to the
   * agent default.
   */
  timeoutMs?: number;
};

export type ProviderResolution =
  | { ok: true; config: ResolvedProvider }
  | { ok: false; error: ProviderError };

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Truncates and strips control characters from environment values in errors. */
function safeValue(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
}

/** Environment variable prefix for an agent. */
export function envPrefixFor(agent: AgentName): "PLANNER" | "CODING" {
  return agent === "planner" ? "PLANNER" : "CODING";
}

/**
 * Resolves the provider, model, base URL and key for one agent.
 *
 * Precedence (each step falls through only when the previous is unset):
 *   provider: <AGENT>_PROVIDER   -> MODEL_PROVIDER      -> "gemini"
 *   model:    <AGENT>_MODEL      -> provider default
 *   base URL: <AGENT>_BASE_URL   -> provider default
 *   API key:  <AGENT>_API_KEY    -> <PROVIDER>_API_KEY  -> MODEL_API_KEY
 *
 * When no provider is named and no key is present the agent is simply
 * unconfigured, which keeps the existing demo/fixture behaviour. Naming a
 * provider without a key is treated as a configuration error instead of
 * silently falling back.
 */
export function resolveProviderConfig(agent: AgentName): ProviderResolution {
  const prefix = envPrefixFor(agent);
  const providerRaw = readEnv(`${prefix}_PROVIDER`) || readEnv("MODEL_PROVIDER");
  const providerValue = providerRaw.toLowerCase();

  if (providerValue.length > 0 && !isProviderId(providerValue)) {
    return {
      ok: false,
      error: new ProviderError(
        "invalid_provider",
        `Unknown model provider "${safeValue(providerRaw)}" for the ${agent} agent. Use one of: ${PROVIDER_IDS.join(", ")}.`,
      ),
    };
  }

  const provider: ProviderId = isProviderId(providerValue) ? providerValue : DEFAULT_PROVIDER;
  const defaults = PROVIDER_DEFAULTS[provider];

  const model = readEnv(`${prefix}_MODEL`) || defaults.model;
  if (model.length === 0) {
    return {
      ok: false,
      error: new ProviderError(
        "invalid_model",
        `No model is configured for the ${agent} agent. Set ${prefix}_MODEL.`,
      ),
    };
  }

  const baseUrl = readEnv(`${prefix}_BASE_URL`) || defaults.baseUrl;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return {
      ok: false,
      error: new ProviderError(
        "invalid_base_url",
        `The base URL configured for the ${agent} agent is not a valid URL. Set ${prefix}_BASE_URL to an https URL.`,
      ),
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      error: new ProviderError(
        "invalid_base_url",
        `The base URL configured for the ${agent} agent must use http or https.`,
      ),
    };
  }

  let maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS[agent];
  const outputRaw = readEnv(`${prefix}_MAX_OUTPUT_TOKENS`);
  if (outputRaw.length > 0) {
    const parsed = Number(outputRaw);
    if (
      !Number.isInteger(parsed) ||
      parsed < OUTPUT_TOKEN_LIMITS.min ||
      parsed > OUTPUT_TOKEN_LIMITS.max
    ) {
      return {
        ok: false,
        error: new ProviderError(
          "invalid_output_limit",
          `${prefix}_MAX_OUTPUT_TOKENS for the ${agent} agent must be a whole number between ${OUTPUT_TOKEN_LIMITS.min} and ${OUTPUT_TOKEN_LIMITS.max}.`,
        ),
      };
    }
    maxOutputTokens = parsed;
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS[agent];
  if (agent === "planner") {
    const timeoutRaw = readEnv("PLANNER_TIMEOUT_MS");
    if (timeoutRaw.length > 0) {
      const parsedTimeout = Number(timeoutRaw);
      if (
        !Number.isInteger(parsedTimeout) ||
        parsedTimeout < TIMEOUT_LIMITS.min ||
        parsedTimeout > TIMEOUT_LIMITS.max
      ) {
        return {
          ok: false,
          error: new ProviderError(
            "invalid_timeout",
            `PLANNER_TIMEOUT_MS for the planner agent must be a whole number between ${TIMEOUT_LIMITS.min} and ${TIMEOUT_LIMITS.max}.`,
          ),
        };
      }
      timeoutMs = parsedTimeout;
    }
  }

  const apiKey =
    readEnv(`${prefix}_API_KEY`) ||
    defaults.keyEnv.map(readEnv).find((value) => value.length > 0) ||
    readEnv("MODEL_API_KEY");

  const providerNamed = providerValue.length > 0;
  if (apiKey.length === 0 && providerNamed) {
    return {
      ok: false,
      error: new ProviderError(
        "missing_credentials",
        `The ${agent} agent is set to use "${provider}", but no API key is configured. Set ${prefix}_API_KEY, ${defaults.keyEnv[0]} or MODEL_API_KEY.`,
      ),
    };
  }

  return {
    ok: true,
    config: {
      agent,
      provider,
      model,
      baseUrl: baseUrl.replace(/\/+$/, ""),
      ...(apiKey.length > 0 ? { apiKey } : {}),
      configured: apiKey.length > 0,
      providerHost: parsed.host,
      maxOutputTokens,
      timeoutMs,
    },
  };
}

export type ChatRequest = {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

/**
 * Builds the chat-completions request for a resolved provider.
 *
 * Gemini keeps the `reasoning_effort: "low"` setting the planner used; Groq and
 * OpenRouter do not accept that field, so it is omitted for them. The output
 * bound comes from the agent's budget (planner 1600 by default, coding 4000),
 * never from the provider.
 */
export function buildChatRequest(
  config: ResolvedProvider,
  systemPrompt: string,
  userPrompt: string,
): ChatRequest {
  if (!config.apiKey) {
    throw new ProviderError(
      "missing_credentials",
      `No API key is configured for the ${config.agent} agent.`,
    );
  }

  const body: Record<string, unknown> = {
    model: config.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS[config.agent],
  };

  if (config.provider === "gemini") {
    body.reasoning_effort = "low";
  }

  return {
    endpoint: `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  };
}

/** Maps an HTTP status to a safe, provider-aware error. */
export function providerErrorForStatus(provider: ProviderId, status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(
      "auth",
      `The ${provider} API rejected the credentials (HTTP ${status}). Check the configured API key.`,
      status,
    );
  }
  if (status === 404) {
    return new ProviderError(
      "not_found",
      `The ${provider} API did not recognise the model or endpoint (HTTP 404). Check the model name.`,
      status,
    );
  }
  if (status === 429) {
    return new ProviderError(
      "rate_limit",
      `The ${provider} API rate-limited the request (HTTP 429). Try again shortly.`,
      status,
    );
  }
  if (status >= 500) {
    return new ProviderError(
      "unavailable",
      `The ${provider} API is unavailable (HTTP ${status}).`,
      status,
    );
  }
  return new ProviderError(
    "request_failed",
    `The ${provider} API rejected the request (HTTP ${status}).`,
    status,
  );
}

/**
 * Normalises a transport failure. The original message is deliberately
 * discarded: it can contain URLs or request details, and this value may be
 * stored in workflow history.
 */
export function providerErrorFromUnknown(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const reason =
    error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : "";

  if (reason.includes("timeout") || reason.includes("abort")) {
    return new ProviderError("timeout", "The model request timed out.");
  }

  return new ProviderError("request_failed", "The model request could not be completed.");
}