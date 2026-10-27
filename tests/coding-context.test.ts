import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { CONTEXT_FILE_LIMIT, selectContextFiles } from "../lib/coding-context.ts";
import { PERMITTED_SOURCE_FILES } from "../lib/coding-paths.ts";
import { buildFixtureProposal } from "../lib/coding-proposal.ts";
import { buildFixturePlan } from "../lib/planner.ts";
import { requestProposal } from "../lib/coding-agent.ts";

const ENV_KEYS = [
  "PLANNER_PROVIDER",
  "PLANNER_MODEL",
  "PLANNER_API_KEY",
  "PLANNER_BASE_URL",
  "PLANNER_MAX_OUTPUT_TOKENS",
  "CODING_PROVIDER",
  "CODING_MODEL",
  "CODING_API_KEY",
  "CODING_BASE_URL",
  "CODING_MAX_OUTPUT_TOKENS",
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

const TASK_REQUESTS = [
  "Mark a task complete when I click the checkbox.",
  "Renaming a completed task must keep it completed.",
  "Editing a task title should keep the task active.",
  "Persist the board in localStorage so it survives a reload.",
  "Add due dates to tasks and let me filter by them.",
];

describe("context selection", () => {
  it("includes lib/tasks.ts for completion requests", () => {
    for (const request of TASK_REQUESTS) {
      assert.ok(selectContextFiles(request).includes("lib/tasks.ts"), request);
    }
  });

  it("includes the board component alongside the domain file for task requests", () => {
    for (const request of TASK_REQUESTS) {
      const files = selectContextFiles(request);
      assert.ok(files.includes("lib/tasks.ts"), request);
      assert.ok(files.includes("components/demo/task-board.tsx"), request);
    }
  });

  it("puts the task domain in context for renaming, editing and persistence wording", () => {
    for (const request of [
      "Rename a task and keep its state",
      "Edit the title of a completed task",
      "Persistence after the page reloads",
    ]) {
      assert.equal(selectContextFiles(request)[0], "lib/tasks.ts", request);
    }
  });

  it("selects the landing page for a landing-page request, not the task board", () => {
    const files = selectContextFiles("Rewrite the hero copy on the landing page.");
    assert.equal(files[0], "app/page.tsx");
    assert.equal(files.includes("lib/tasks.ts"), false);
  });

  it("selects the stylesheet for a styling request", () => {
    const files = selectContextFiles("Make the dark theme easier to read.");
    assert.equal(files[0], "app/globals.css");
    assert.equal(files.includes("lib/tasks.ts"), false);
  });

  it("only ever returns files on the edit allowlist", () => {
    const samples = [...TASK_REQUESTS, "", "Rewrite the hero copy.", "Add a new icon."];
    for (const request of samples) {
      for (const file of selectContextFiles(request)) {
        assert.ok(
          (PERMITTED_SOURCE_FILES as readonly string[]).includes(file),
          `${file} is not on the allowlist for "${request}"`,
        );
      }
    }
  });

  it("returns at most the limit and never duplicates a file", () => {
    const files = selectContextFiles("Mark a task complete and rename it.");
    assert.ok(files.length <= CONTEXT_FILE_LIMIT);
    assert.equal(new Set(files).size, files.length, "no duplicates");
  });

  it("does not pad a relevant prompt with unrelated files", () => {
    const files = selectContextFiles(
      "Renaming a completed task must keep it completed, and the completion state must persist after a reload.",
    );
    assert.deepEqual(files, ["lib/tasks.ts", "components/demo/task-board.tsx"]);
    assert.equal(files.includes("app/page.tsx"), false, "the landing page is not relevant");
    assert.equal(files.includes("app/globals.css"), false, "the stylesheet is not relevant");
  });

  it("only sends matched files when several domains are named", () => {
    const files = selectContextFiles("Style the task checkbox and add a dark theme.");
    assert.ok(files.includes("lib/tasks.ts"));
    assert.ok(files.includes("app/globals.css"));
    assert.equal(files.includes("app/page.tsx"), false);
  });

  it("still sends exactly the limit when nothing is recognisable", () => {
    assert.equal(selectContextFiles("Make it better somehow.").length, CONTEXT_FILE_LIMIT);
  });

  it("respects an explicit limit and clamps a nonsensical one", () => {
    assert.equal(selectContextFiles("Mark a task complete.", 2).length, 2);
    assert.deepEqual(selectContextFiles("Mark a task complete.", 1), ["lib/tasks.ts"]);
    assert.equal(selectContextFiles("Mark a task complete.", -5).length, 1);
    assert.equal(
      selectContextFiles("Make it better somehow.", 99).length,
      PERMITTED_SOURCE_FILES.length,
    );
  });

  it("falls back to declaration order when the request names nothing", () => {
    assert.deepEqual(
      selectContextFiles(""),
      PERMITTED_SOURCE_FILES.slice(0, CONTEXT_FILE_LIMIT),
    );
  });

  it("is deterministic", () => {
    const request = "Renaming a completed task must keep it completed.";
    assert.deepEqual(selectContextFiles(request), selectContextFiles(request));
  });
});

describe("context reaches the coding prompt", () => {
  it("sends lib/tasks.ts and the coding output budget to the model", async () => {
    process.env.CODING_PROVIDER = "groq";
    process.env.CODING_API_KEY = "test-key";

    const fixture = buildFixtureProposal({
      id: "prop_prompt",
      createdAt: 1,
      featureRequest: "Renaming a completed task must keep it completed.",
    });
    const modelReply = JSON.stringify({
      explanation: fixture.explanation,
      files: fixture.files,
      diff: fixture.diff,
    });

    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: modelReply }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await requestProposal({
      featureRequest: "Renaming a completed task must keep it completed.",
      plan: buildFixturePlan("Renaming a completed task must keep it completed."),
      id: "prop_prompt",
      createdAt: 1,
      fetchImpl,
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);

    const messages = calls[0]?.body.messages as { role: string; content: string }[];
    const userPrompt = messages[1]?.content ?? "";
    assert.match(userPrompt, /### lib\/tasks\.ts/);
    assert.match(userPrompt, /### components\/demo\/task-board\.tsx/);
    assert.equal(calls[0]?.body.max_tokens, 4000);
  });
});