import { listWorkflows, startWorkflow } from "@/lib/workflow-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Lists every stored workflow, newest first. */
export async function GET() {
  const workflows = await listWorkflows();
  return json({ workflows });
}

/**
 * Creates a workflow and runs the planning stage.
 *
 * Only `feature` and `fixture` are read. Any client-supplied status, actor or
 * proposal is ignored: the workflow always starts in `planning`.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Send a JSON body with a `feature` field." }, 400);
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return json({ error: "Send a JSON body with a `feature` field." }, 400);
  }

  const record = payload as Record<string, unknown>;

  const feature = typeof record.feature === "string" ? record.feature : "";
  const fixture = record.fixture;

  const result = await startWorkflow({ feature, fixture });

  if (!result.ok) {
    return json({ error: result.error, failure: result.failure }, result.status);
  }

  return json({ workflow: result.value }, 201);
}
