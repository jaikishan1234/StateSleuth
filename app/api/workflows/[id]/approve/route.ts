import { approveWorkflowPlan } from "@/lib/workflow-service";
import { isValidWorkflowId } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Human approval of the generated plan.
 *
 * The next status is decided entirely on the server from the stored workflow
 * state. A client-supplied status is never read.
 */
export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;

  if (!isValidWorkflowId(id)) {
    return json({ error: "No workflow with that id." }, 404);
  }

  const result = await approveWorkflowPlan({ id });
  if (!result.ok) {
    return json({ error: result.error, failure: result.failure }, result.status);
  }

  return json({ workflow: result.value });
}
