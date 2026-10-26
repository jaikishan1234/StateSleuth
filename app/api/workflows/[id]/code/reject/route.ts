import { checkLocalRequest } from "@/lib/local-guard";
import { rejectCodeProposal } from "@/lib/workflow-service";
import { isValidWorkflowId } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Human rejection of the code proposal. A non-empty reason is required and is
 * recorded in the workflow history.
 *
 * Local-only, for consistency with the approval endpoint.
 */
export async function POST(request: Request, context: Context) {
  const local = checkLocalRequest(request);
  if (!local.ok) {
    return json({ error: local.reason, localOnly: true }, 403);
  }

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

  const result = await rejectCodeProposal({ id, reason });

  if (!result.ok) {
    return json({ error: result.error, failure: result.failure }, result.status);
  }

  return json({ workflow: result.value });
}