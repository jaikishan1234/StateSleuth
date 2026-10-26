/**
 * Server-only planner client.
 *
 * Shared by `POST /api/plan` and the workflow API so both use exactly the same
 * model configuration, timeout and validation. The Gemini model id, base URL
 * and timeout are unchanged from the Phase 3 implementation.
 *
 * This module must never be imported from a client component: it reads
 * credentials and calls the model provider.
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
import { getPlannerConfig } from "./planner-config.ts";

/** Unchanged from the Phase 3 implementation. */
export const MODEL_TIMEOUT_MS = 45_000;

export type PlanOutcome =
  | { mode: "live"; model: string; plan: FeaturePlan }
  | { mode: "demo"; notice: string; plan: FeaturePlan }
  | { mode: "fixture"; notice: string; plan: FeaturePlan };

export type PlanGenerationResult =
  | { ok: true; value: PlanOutcome }
  | { ok: false; error: string; detail?: string[] | string };

async function requestPlan(feature: string): Promise<unknown> {
  const content = await callChatCompletion(
    PLAN_SYSTEM_PROMPT,
    `Feature request:\n${feature}`,
  );
  return parsePlanJson(content);
}

/**
 * Calls the configured chat completions endpoint and returns the raw text.
 *
 * Shared by the planner and the coding agent so both use the same model,
 * timeout and request shape. The model id, base URL and timeout are unchanged.
 *
 * Throws on an upstream failure. The upstream body is never returned, so
 * provider details and credentials cannot reach the browser.
 */
export async function callChatCompletion(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const config = getPlannerConfig();

  if (!config.configured) {
    throw new Error("No model credentials are configured.");
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      reasoning_effort: "low",
      max_tokens: 1600,
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    // The upstream body is deliberately not returned, so provider details and
    // any credential in it can never reach the browser.
    console.error(`[planner] model endpoint returned ${response.status}`);
    throw new Error(`model endpoint returned HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("model response contained no text");
  }

  return content;
}

/**
 * Produces a plan for a feature request.
 *
 * In explicit fixture mode a deterministic, clearly labelled test plan is
 * returned and no provider call is made. Otherwise, when no credentials are
 * configured the result is a clearly labelled demo plan. When credentials
 * exist but the provider call fails, this returns a failure: it never falls
 * back to a demo plan or a fixture.
 */
export async function generatePlan(
  feature: string,
  options: { fixture?: boolean } = {},
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

  const config = getPlannerConfig();

  if (!config.configured) {
    return {
      ok: true,
      value: { mode: "demo", notice: DEMO_NOTICE, plan: buildDemoPlan(feature) },
    };
  }

  try {
    const result = await requestPlan(feature);

    if (typeof result === "object" && result !== null && "ok" in result) {
      const parsed = result as
        | { ok: true; plan: unknown }
        | { ok: false; issues: string[] };

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

      return { ok: true, value: { mode: "live", model: config.model, plan: checked.plan } };
    }

    return { ok: false, error: "The model response could not be read." };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    const timedOut =
      reason.toLowerCase().includes("timeout") || reason.toLowerCase().includes("abort");
    console.error(`[planner] live request failed: ${reason}`);

    return {
      ok: false,
      error: timedOut
? "The model request timed out. No demo or fixture plan was substituted."
      : "The model request failed. No demo or fixture plan was substituted.",
      detail: reason,
    };
  }
}

export function planModeOf(outcome: PlanOutcome): PlanMode {
  return outcome.mode;
}
