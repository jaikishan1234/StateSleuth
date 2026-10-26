import { readWorkflow } from "@/lib/workflow-service";
import { isValidWorkflowId } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Returns the current state of a workflow. */
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;

  if (!isValidWorkflowId(id)) {
    return json({ error: "No workflow with that id." }, 404);
  }

  const result = await readWorkflow(id);
  if (!result.ok) {
    return json({ error: result.error }, result.status);
  }

  return json({ workflow: result.value });
}
