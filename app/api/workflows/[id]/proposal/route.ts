import { requestCodeProposal } from "@/lib/workflow-service";
import { isValidWorkflowId } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Asks the coding agent for a reviewable proposal.
 *
 * Only a workflow in the `coding` state may request one. The patch is never
 * applied here: no source file is written and no shell command is run.
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;

  if (!isValidWorkflowId(id)) {
    return json({ error: "No workflow with that id." }, 404);
  }

  let useFixture = false;
  try {
    const payload: unknown = await request.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { fixture?: unknown }).fixture === "boolean"
    ) {
      useFixture = (payload as { fixture: boolean }).fixture;
    }
  } catch {
    // An empty body is fine: a proposal is requested by default.
  }

  const result = await requestCodeProposal({ id, useFixture });

  if (!result.ok) {
    return json({ error: result.error, failure: result.failure }, result.status);
  }

  return json({ workflow: result.value });
}
