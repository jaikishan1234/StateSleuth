import { rejectWorkflowPlan } from "@/lib/workflow-service";
import { isValidWorkflowId } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Human rejection of the generated plan. A reason is required.
 *
 * The next status is decided entirely on the server from the stored workflow
 * state. A client-supplied status is never read.
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;

  if (!isValidWorkflowId(id)) {
    return json({ error: "No workflow with that id." }, 404);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Send a JSON body with a `reason` field." }, 400);
  }

  const reason =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { reason?: unknown }).reason === "string"
      ? (payload as { reason: string }).reason
      : "";

  const result = await rejectWorkflowPlan({ id, reason });
  if (!result.ok) {
    return json({ error: result.error, failure: result.failure }, result.status);
  }

  return json({ workflow: result.value });
}
