import { PLANNER_LIMITS } from "@/lib/planner";
import { generatePlan } from "@/lib/planner-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const result = await generatePlan(feature);

  if (!result.ok) {
    return json({ error: result.error, detail: result.detail }, 502);
  }

  if (result.value.mode === "live") {
    return json({ mode: "live", model: result.value.model, plan: result.value.plan });
  }

  // Demo and fixture plans are both generated locally and carry a notice.
  return json({
    mode: result.value.mode,
    notice: result.value.notice,
    plan: result.value.plan,
  });
}
