/**
 * Server-only model client shared by the planner and the coding agent.
 *
 * Transport lives here; provider selection lives in lib/provider-config.ts.
 * The Gemini request shape, timeout and validation are unchanged from the
 * Phase 3 implementation.
 *
 * Never import this module from a client component: it reads credentials and
 * calls the model provider.
 */

import {
  DEMO_NOTICE,
  FIXTURE_PLAN_NOTICE,
  PLAN_SYSTEM_PROMPT,
  buildDemoPlan,
  buildFixturePlan,
  parsePlanJson,
  validatePlan,
  type FeaturePlan,
  type PlanMode,
} from "./planner.ts";
import {
  buildChatRequest,
  providerErrorForStatus,
  providerErrorFromUnknown,
  ProviderError,
  resolveProviderConfig,
  type AgentName,
  type ProviderId,
} from "./provider-config.ts";

/** Unchanged from the Phase 3 implementation. */
export const MODEL_TIMEOUT_MS = 45_000;

export type PlanOutcome =
  | { mode: "live"; model: string; plan: FeaturePlan }
  | { mode: "demo"; notice: string; plan: FeaturePlan }
  | { mode: "fixture"; notice: string; plan: FeaturePlan };

export type PlanGenerationResult =
  | { ok: true; value: PlanOutcome }
  | { ok: false; error: string; detail?: string[] | string };

export type ChatCompletionResult = {
  content: string;
  model: string;
  provider: ProviderId;
};

export type ChatCompletionOptions = {
  /** Test seam: lets tests inspect and stub the outbound request. */
  fetchImpl?: typeof fetch;
};

/**
 * Calls the configured chat-completions endpoint for one agent.
 *
 * Throws a `ProviderError` with a safe message on any failure. The upstream
 * body is never read into the error, so provider details and credentials
 * cannot reach the browser or the workflow history.
 */
export async function callChatCompletion(
  agent: AgentName,
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  const resolution = resolveProviderConfig(agent);
  if (!resolution.ok) throw resolution.error;

  const config = resolution.config;
  const request = buildChatRequest(config, systemPrompt, userPrompt);
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw providerErrorFromUnknown(error);
  }

  if (!response.ok) {
    // Only the status is used; the upstream body is never surfaced or logged.
    console.error(`[model] ${config.provider} endpoint returned ${response.status}`);
    throw providerErrorForStatus(config.provider, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderError("bad_response", `The ${config.provider} API returned an unreadable response.`);
  }

  const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new ProviderError("bad_response", `The ${config.provider} API returned no text.`);
  }

  return { content, model: config.model, provider: config.provider };
}

function planFailureMessage(error: ProviderError): string {
  switch (error.code) {
    case "timeout":
      return "The model request timed out. No demo or fixture plan was substituted.";
    case "auth":
      return "The model provider rejected the credentials. No demo or fixture plan was substituted.";
    case "rate_limit":
      return "The model provider rate-limited the request. No demo or fixture plan was substituted.";
    case "unavailable":
      return "The model provider is unavailable. No demo or fixture plan was substituted.";
    case "not_found":
      return "The model provider did not recognise the model or endpoint. No demo or fixture plan was substituted.";
    default:
      return "The model request failed. No demo or fixture plan was substituted.";
  }
}

/**
 * Produces a plan for a feature request.
 *
 * In explicit fixture mode a deterministic, clearly labelled test plan is
 * returned and no provider call is made. When no provider is configured at all
 * the result is a clearly labelled demo plan. When a provider is configured but
 * the call fails, this returns a failure: it never falls back to a demo plan or
 * a fixture.
 */
export async function generatePlan(
  feature: string,
  options: { fixture?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<PlanGenerationResult> {
  if (options.fixture === true) {
    return {
      ok: true,
      value: {
        mode: "fixture",
        notice: FIXTURE_PLAN_NOTICE,
        plan: buildFixturePlan(feature),
      },
    };
  }

  const resolution = resolveProviderConfig("planner");
  if (!resolution.ok) {
    return { ok: false, error: resolution.error.message };
  }

  if (!resolution.config.configured) {
    return {
      ok: true,
      value: { mode: "demo", notice: DEMO_NOTICE, plan: buildDemoPlan(feature) },
    };
  }

  try {
    const completion = await callChatCompletion(
      "planner",
      PLAN_SYSTEM_PROMPT,
      `Feature request:\n${feature}`,
      options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
    );

    const parsed = parsePlanJson(completion.content);

    if (!parsed.ok) {
      console.error("[planner] model output failed validation:", parsed.issues);
      return {
        ok: false,
        error: "The model returned a plan that did not match the required structure.",
        detail: parsed.issues.slice(0, 5),
      };
    }

    // Re-validate the narrowed plan so the value is a genuine FeaturePlan.
    const checked = validatePlan(parsed.plan);
    if (!checked.ok) {
      console.error("[planner] model output failed validation:", checked.issues);
      return {
        ok: false,
        error: "The model returned a plan that did not match the required structure.",
        detail: checked.issues.slice(0, 5),
      };
    }

    return {
      ok: true,
      value: { mode: "live", model: completion.model, plan: checked.plan },
    };
  } catch (error) {
    const providerError = providerErrorFromUnknown(error);
    console.error(`[planner] live request failed: ${providerError.message}`);

    return {
      ok: false,
      error: planFailureMessage(providerError),
      detail: providerError.message,
    };
  }
}

export function planModeOf(outcome: PlanOutcome): PlanMode {
  return outcome.mode;
}