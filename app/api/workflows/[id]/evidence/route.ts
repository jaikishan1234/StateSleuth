import { readFile } from "node:fs/promises";
import { checkLocalRequest } from "@/lib/local-guard";
import { evidencePath } from "@/lib/verification-evidence";
import { readWorkflow } from "@/lib/workflow-service";
import { isValidWorkflowId } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Serves the screenshot recorded by a verification run.
 *
 * The file name comes from the stored workflow record, never from the request,
 * and is validated as a plain `.png` file name, so this route cannot read
 * anything outside the evidence directory. Local-only, like the run itself:
 * evidence is a picture of this machine's local demo app.
 */
export async function GET(request: Request, context: Context) {
  const local = checkLocalRequest(request);
  if (!local.ok) {
    return json({ error: local.reason, localOnly: true }, 403);
  }

  const { id } = await context.params;
  if (!isValidWorkflowId(id)) {
    return json({ error: "No workflow with that id." }, 404);
  }

  const result = await readWorkflow(id);
  if (!result.ok) {
    return json({ error: result.error }, result.status);
  }

  const name = result.value.verification?.screenshot;
  if (!name) {
    return json({ error: "No screenshot evidence is recorded for this workflow." }, 404);
  }

  const file = evidencePath(name);
  if (!file) {
    return json({ error: "The recorded evidence name is not usable." }, 404);
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return json({ error: "The recorded screenshot is no longer on disk." }, 404);
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}