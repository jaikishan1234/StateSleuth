import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { requestProposal } from "../lib/coding-agent.ts";
import { buildFixturePlan } from "../lib/planner.ts";

const ENV_KEYS = [
  "PLANNER_PROVIDER",
  "PLANNER_MODEL",
  "PLANNER_API_KEY",
  "PLANNER_BASE_URL",
  "PLANNER_MAX_OUTPUT_TOKENS",
  "PLANNER_TIMEOUT_MS",
  "CODING_PROVIDER",
  "CODING_MODEL",
  "CODING_API_KEY",
  "CODING_BASE_URL",
  "CODING_MAX_OUTPUT_TOKENS",
  "CODING_TIMEOUT_MS",
  "MODEL_PROVIDER",
  "MODEL_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(clearEnv);
after(clearEnv);

const FEATURE = "Add a task priority field with low, medium and high options.";

/** A complete diff: 3 old lines, 4 new lines. */
const VALID_DIFF = [
  "--- a/lib/tasks.ts",
  "+++ b/lib/tasks.ts",
  "@@ -4,3 +4,4 @@",
  "   id: string,",
  "+  priority?: string,",
  "   title: string,",
  "   completed: boolean,",
].join("\n");

/** Same body, header counts deliberately wrong: the retryable failure. */
const COUNT_MISMATCH_DIFF = VALID_DIFF.replace("@@ -4,3 +4,4 @@", "@@ -4,9 +4,9 @@");

/**
 * Passes the broad shape check (it has a --- line and a numbered hunk header)
 * but the parser rejects it for a different reason: no +++ header. Not retryable.
 */
const NO_PLUS_HEADER_DIFF = [
  "--- a/lib/tasks.ts",
  "@@ -4,3 +4,4 @@",
  "   id: string,",
  "+  priority?: string,",
].join("\n");

function proposalJson(diff: string): string {
  return JSON.stringify({
    explanation: "Add a priority field to the task type.",
    files: [{ path: "lib/tasks.ts", change: "modify", summary: "Add the field." }],
    diff,
  });
}

type Call = { body: Record<string, unknown> };

function replies(diffs: string[], calls: Call[]): typeof fetch {
  let index = 0;
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const diff = diffs[Math.min(index, diffs.length - 1)];
    index += 1;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: proposalJson(diff) }, finish_reason: "stop" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

function promptOf(call: Call | undefined): string {
  const messages = (call?.body.messages ?? []) as { role: string; content: string }[];
  return messages[1]?.content ?? "";
}

function configureCoding(): void {
  process.env.CODING_PROVIDER = "groq";
  process.env.CODING_API_KEY = "test-key";
}

function run(fetchImpl: typeof fetch) {
  return requestProposal({
    featureRequest: FEATURE,
    plan: buildFixturePlan(FEATURE),
    id: "prop_retry",
    createdAt: 1,
    fetchImpl,
  });
}

describe("corrective retry on hunk count mismatch", () => {
  it("retries once and accepts a corrected diff", async () => {
    configureCoding();
    const calls: Call[] = [];
    const result = await run(replies([COUNT_MISMATCH_DIFF, VALID_DIFF], calls));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.proposal.diff, VALID_DIFF);
    assert.equal(calls.length, 2);
    assert.equal(promptOf(calls[0]).includes("Correction required"), false);
    assert.equal(promptOf(calls[1]).includes("Correction required"), true);
    assert.match(promptOf(calls[1]), /a hunk's line counts do not match its header/);
    assert.match(promptOf(calls[1]), /oldCount = context lines \+ removed lines/);
  });

  it("stops after one retry when the counts are still wrong", async () => {
    configureCoding();
    const calls: Call[] = [];
    const result = await run(replies([COUNT_MISMATCH_DIFF, COUNT_MISMATCH_DIFF], calls));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(calls.length, 2, "exactly one retry, never a third call");
    assert.match(result.error, /after one corrective retry/);
    assert.match(result.error, /line counts do not match its header/);
    assert.equal("proposal" in result, false, "a configured provider never falls back to a fixture");
  });

  it("does not retry a diff the parser rejects for another reason", async () => {
    configureCoding();
    const calls: Call[] = [];
    const result = await run(replies([NO_PLUS_HEADER_DIFF, VALID_DIFF], calls));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(calls.length, 1, "only count mismatches are retried");
    assert.match(result.error, /missing its \+\+\+ header/);
    assert.equal("proposal" in result, false);
  });

  it("does not retry unreadable JSON", async () => {
    configureCoding();
    const calls: Call[] = [];
    let index = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      index += 1;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "not json at all" }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await run(fetchImpl);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(calls.length, 1);
    assert.match(result.error, /did not return a readable proposal/);
    assert.equal(index, 1);
  });

  it("does not retry a provider failure", async () => {
    configureCoding();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: 429 });
    }) as unknown as typeof fetch;

    const result = await run(fetchImpl);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(calls, 1);
    assert.match(result.error, /rate_limit/);
    assert.match(result.error, /No fixture proposal was substituted/);
    assert.equal("proposal" in result, false);
  });

  it("still returns the labelled fixture when no provider is configured", async () => {
    const result = await run(replies([VALID_DIFF], []));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.proposal.source, "fixture");
  });
});