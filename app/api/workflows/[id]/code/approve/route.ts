import { checkLocalRequest } from "@/lib/local-guard";
import { approveCodeProposal } from "@/lib/workflow-service";
import { isValidWorkflowId } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Human approval of the code proposal, which APPLIES the patch.
 *
 * The body may only carry `confirm: true`. Paths, diff contents, status and
 * actor come from the stored workflow and are never read from the client.
 *
 * Local-only: see lib/local-guard.ts. This is a loopback heuristic, not
 * authentication — the real protection is binding the server to 127.0.0.1.
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

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    // An empty body is treated as "not confirmed".
  }

  const confirm =
    typeof payload === "object" && payload !== null
      ? (payload as { confirm?: unknown }).confirm
      : undefined;

  const result = await approveCodeProposal({ id, confirm });

  if (!result.ok) {
    return json(
      {
        error: result.error,
        failure: result.failure,
        applied: result.applied,
        filesChanged: result.filesChanged,
      },
      result.status,
    );
  }

  return json({ workflow: result.value });
}