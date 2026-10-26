import {
  DEMO_NOTICE,
  PLAN_SYSTEM_PROMPT,
  PLANNER_LIMITS,
  buildDemoPlan,
  parsePlanJson,
} from "@/lib/planner";
import { getPlannerConfig, type PlannerConfig } from "@/lib/planner-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_TIMEOUT_MS = 45_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6;

const recentRequests = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "local";
}

function takeRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = recentRequests.get(key);

  if (!entry || entry.resetAt <= now) {
    recentRequests.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function requestPlan(config: PlannerConfig, feature: string): Promise<unknown> {
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
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: `Feature request:\n${feature}` },
      ],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    // The upstream body is logged, not returned, so provider details never
    // reach the browser.
    console.error(`[planner] model endpoint returned ${response.status}`);
    throw new Error(`model endpoint returned HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("model response contained no text");
  }

  return parsePlanJson(content);
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Send a JSON body with a `feature` field." }, 400);
  }

  const feature =
    typeof payload === "object" && payload !== null && typeof (payload as { feature?: unknown }).feature === "string"
      ? ((payload as { feature: string }).feature ?? "").trim()
      : "";

  if (feature.length < PLANNER_LIMITS.featureMin) {
    return json(
      { error: `Describe the feature in at least ${PLANNER_LIMITS.featureMin} characters.` },
      400,
    );
  }

  if (feature.length > PLANNER_LIMITS.featureMax) {
    return json(
      { error: `Keep the description under ${PLANNER_LIMITS.featureMax} characters.` },
      400,
    );
  }

  const limit = takeRateLimit(clientKey(request));
  if (!limit.allowed) {
    return json(
      { error: "Too many plans requested in a row. Wait a moment and try again." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  const config = getPlannerConfig();

  if (!config.configured) {
    return json({
      mode: "demo",
      notice: DEMO_NOTICE,
      plan: buildDemoPlan(feature),
    });
  }

  try {
    const result = await requestPlan(config, feature);
    if (typeof result === "object" && result !== null && "ok" in result) {
      const parsed = result as
        | { ok: true; plan: unknown }
        | { ok: false; issues: string[] };

      if (!parsed.ok) {
        console.error("[planner] model output failed validation:", parsed.issues);
        return json(
          {
            error: "The model returned a plan that did not match the required structure.",
            detail: parsed.issues.slice(0, 5),
          },
          502,
        );
      }

      return json({ mode: "live", model: config.model, plan: parsed.plan });
    }

    return json({ error: "The model response could not be read." }, 502);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    const timedOut = reason.toLowerCase().includes("timeout") || reason.toLowerCase().includes("abort");
    console.error(`[planner] live request failed: ${reason}`);

    return json(
      {
        error: timedOut
          ? "The model request timed out. No demo plan was substituted."
          : "The model request failed. No demo plan was substituted.",
        detail: reason,
      },
      502,
    );
  }
}