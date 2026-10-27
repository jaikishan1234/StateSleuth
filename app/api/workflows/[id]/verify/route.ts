import { checkLocalRequest } from "@/lib/local-guard";
import { runWorkflowVerification } from "@/lib/workflow-service";
import { isValidWorkflowId } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A real browser launch and a page journey take longer than a JSON request. */
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Runs the browser verification journey and records the verdict.
 *
 * The request body is deliberately ignored: a caller cannot choose a URL,
 * a browser, a journey or a command. The only page driven is `/demo` on this
 * server's own origin, and `runWorkflowVerification` re-checks that the origin
 * is loopback. No proposal is approved and no source file is written here.
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

  const result = await runWorkflowVerification({ id, baseUrl: new URL(request.url).origin });

  if (!result.ok) {
    return json({ error: result.error, failure: result.failure }, result.status);
  }

  return json({ workflow: result.value });
}