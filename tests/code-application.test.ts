import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  FIXTURE_NOTICE,
  type CodingProposal,
  type ProposalFile,
} from "../lib/coding-proposal.ts";
import { applyProposal, captureProposalSnapshot, sha256, parseUnifiedDiff } from "../lib/patch-apply.ts";
import { createWorkflowStore } from "../lib/workflow-store.ts";
import {
  approveCodeProposal,
  approveWorkflowPlan,
  rejectCodeProposal,
  requestCodeProposal,
  startWorkflow,
} from "../lib/workflow-service.ts";

const TASKS_TEMPLATE = [
  "export type Task = {",
  "  id: string;",
  "  title: string;",
  "  completed: boolean;",
  "  createdAt: number;",
  "  updatedAt: number;",
  "};",
  "",
].join("\n");

const PLANNER_TEMPLATE = ["export const A = 1;", "", ""].join("\n");

async function withProject<T>(
  run: (root: string) => Promise<T>,
  files: Record<string, string> = {
    "lib/tasks.ts": TASKS_TEMPLATE,
    "lib/planner.ts": PLANNER_TEMPLATE,
  },
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "statesleuth-apply-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const absolute = path.join(root, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, content, "utf8");
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withStore<T>(
  run: (store: ReturnType<typeof createWorkflowStore>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "statesleuth-store-"));
  const store = createWorkflowStore(dir);
  try {
    return await run(store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function proposal(overrides: {
  files?: ProposalFile[];
  diff: string;
  snapshot?: { path: string; sha256: string }[];
}): CodingProposal {
  return {
    id: "prop_test",
    source: "fixture",
    explanation: "Add a due date field to the task type.",
    files: overrides.files ?? [
      { path: "lib/tasks.ts", change: "modify", summary: "Add a dueDate field." },
    ],
    diff: overrides.diff,
    createdAt: 1_000,
    notice: FIXTURE_NOTICE,
    ...(overrides.snapshot ? { snapshot: overrides.snapshot } : {}),
  };
}

const TASKS_DIFF = [
  "--- a/lib/tasks.ts",
  "+++ b/lib/tasks.ts",
  "@@ -1,7 +1,8 @@",
  " export type Task = {",
  "   id: string;",
  "   title: string;",
  "+  dueDate?: string;",
  "   completed: boolean;",
  "   createdAt: number;",
  "   updatedAt: number;",
  " };",
].join("\n");

const SECOND_DIFF = [
  "--- a/lib/planner.ts",
  "+++ b/lib/planner.ts",
  "@@ -1,2 +1,3 @@",
  " export const A = 1;",
  "+export const B = 2;",
  " ",
].join("\n");

describe("patch parsing", () => {
  it("parses a single-file diff", () => {
    const parsed = parseUnifiedDiff(TASKS_DIFF);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.sections.length, 1);
    assert.equal(parsed.sections[0]?.path, "lib/tasks.ts");
    assert.equal(parsed.sections[0]?.hunks.length, 1);
  });

  it("rejects a hunk whose counts do not match its header", () => {
    const broken = TASKS_DIFF.replace("@@ -1,7 +1,8 @@", "@@ -1,9 +1,9 @@");
    const parsed = parseUnifiedDiff(broken);
    assert.equal(parsed.ok, false);
  });

  it("rejects a diff that would delete a file", () => {
    const deletion = "--- a/lib/tasks.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n";
    assert.equal(parseUnifiedDiff(deletion).ok, false);
  });

  it("rejects prose that is not a diff", () => {
    assert.equal(parseUnifiedDiff("please change the file").ok, false);
  });
});

describe("patch application", () => {
  it("applies a valid diff to the permitted file only", async () => {
    await withProject(async (root) => {
      const original = await readFile(path.join(root, "lib/tasks.ts"), "utf8");
      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({ diff: TASKS_DIFF, snapshot: [{ path: "lib/tasks.ts", sha256: sha256(original) }] }),
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.applied, ["lib/tasks.ts"]);

      const updated = await readFile(path.join(root, "lib/tasks.ts"), "utf8");
      assert.match(updated, /dueDate\?: string;/);
      assert.match(updated, /export type Task = \{/);
      assert.equal(
        await readFile(path.join(root, "lib/planner.ts"), "utf8"),
        PLANNER_TEMPLATE,
        "other files must not change",
      );
    });
  });

  it("rejects a file that is not on the allowlist", async () => {
    await withProject(async (root) => {
      const original = await readFile(path.join(root, "lib/tasks.ts"), "utf8");
      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({
          files: [{ path: ".env.local", change: "modify", summary: "x" }],
          diff: "--- a/.env.local\n+++ b/.env.local\n@@ -1 +1 @@\n-A=1\n+A=2\n",
          snapshot: [{ path: ".env.local", sha256: sha256("A=1\n") }],
        }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        // Rejected either by the stored-proposal validator or by the apply-time
        // path check; both are refusals, and neither may write.
        assert.ok(
          ["not_permitted", "invalid_proposal"].includes(result.failure.code),
          `unexpected failure code: ${result.failure.code}`,
        );
      }
      assert.equal(await readFile(path.join(root, "lib/tasks.ts"), "utf8"), original);
    });
  });

  it("rejects traversal and absolute paths", async () => {
    await withProject(async (root) => {
      for (const badPath of ["../outside.ts", "/etc/passwd", "lib/../../outside.ts", "C:/Windows/x.ts"]) {
        const result = await applyProposal({
          projectRoot: root,
          proposal: proposal({
            files: [{ path: badPath, change: "modify", summary: "x" }],
            diff: `--- a/${badPath}\n+++ b/${badPath}\n@@ -1 +1 @@\n-a\n+b\n`,
            snapshot: [{ path: badPath, sha256: sha256("a\n") }],
          }),
        });
        assert.equal(result.ok, false);
      }
    });
  });

  it("rejects add and delete operations", async () => {
    await withProject(async (root) => {
      const original = await readFile(path.join(root, "lib/tasks.ts"), "utf8");
      for (const change of ["add", "delete"] as const) {
        const result = await applyProposal({
          projectRoot: root,
          proposal: proposal({
            files: [{ path: "lib/tasks.ts", change, summary: "x" }],
            diff: TASKS_DIFF,
            snapshot: [{ path: "lib/tasks.ts", sha256: sha256(original) }],
          }),
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.failure.code, "unsupported_change");
      }
    });
  });

  it("rejects a symlink target", async (t) => {
    await withProject(async (root) => {
      const outside = path.join(root, "..", `outside-${Date.now()}.txt`);
      await writeFile(outside, TASKS_TEMPLATE, "utf8");
      const linkPath = path.join(root, "lib", "tasks.ts");
      try {
        await symlink(outside, linkPath, "file");
      } catch {
        t.skip("symlinks are not permitted on this machine");
        return;
      }

      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({ diff: TASKS_DIFF, snapshot: [{ path: "lib/tasks.ts", sha256: sha256(TASKS_TEMPLATE) }] }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.code, "not_permitted");
      await rm(outside, { force: true });
    });
  });

  it("rejects a target that resolves outside the root through a directory link", async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "statesleuth-apply-"));
    const outside = await mkdtemp(path.join(tmpdir(), "statesleuth-outside-"));
    try {
      await writeFile(path.join(outside, "tasks.ts"), TASKS_TEMPLATE, "utf8");

      try {
        await symlink(outside, path.join(root, "lib"), process.platform === "win32" ? "junction" : "dir");
      } catch {
        t.skip("directory links are not permitted on this machine");
        return;
      }

      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({
          diff: TASKS_DIFF,
          snapshot: [{ path: "lib/tasks.ts", sha256: sha256(TASKS_TEMPLATE) }],
        }),
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(
          ["not_permitted", "io_error"].includes(result.failure.code),
          `unexpected failure code: ${result.failure.code}`,
        );
      }
      assert.equal(await readFile(path.join(outside, "tasks.ts"), "utf8"), TASKS_TEMPLATE);
    } finally {
      await rm(path.join(root, "lib"), { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a stale proposal without writing anything", async () => {
    await withProject(async (root) => {
      const target = path.join(root, "lib/tasks.ts");
      const original = await readFile(target, "utf8");
      const snapshot = [{ path: "lib/tasks.ts", sha256: sha256(original) }];

      // Someone edits the file after the proposal was captured.
      await writeFile(target, `${original}// newer work\n`, "utf8");
      const changed = await readFile(target, "utf8");

      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({ diff: TASKS_DIFF, snapshot }),
      });

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.code, "stale");
      assert.equal(await readFile(target, "utf8"), changed, "the newer work must be preserved");
    });
  });

  it("rejects a proposal with no snapshot", async () => {
    await withProject(async (root) => {
      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({ diff: TASKS_DIFF }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.code, "missing_snapshot");
    });
  });

  it("rejects a diff whose context no longer matches", async () => {
    await withProject(async (root) => {
      const original = await readFile(path.join(root, "lib/tasks.ts"), "utf8");
      const mismatched = TASKS_DIFF.replace("   title: string;", "   label: string;");
      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({ diff: mismatched, snapshot: [{ path: "lib/tasks.ts", sha256: sha256(original) }] }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.code, "conflict");
    });
  });

  it("rejects a diff that declares a file the proposal did not list", async () => {
    await withProject(async (root) => {
      const original = await readFile(path.join(root, "lib/tasks.ts"), "utf8");
      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({
          diff: `${TASKS_DIFF}\n${SECOND_DIFF}`,
          snapshot: [
            { path: "lib/tasks.ts", sha256: sha256(original) },
            { path: "lib/planner.ts", sha256: sha256(PLANNER_TEMPLATE) },
          ],
        }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.code, "malformed_diff");
    });
  });

  it("rolls back the first file when a later write fails", async () => {
    await withProject(async (root) => {
      const tasksOriginal = await readFile(path.join(root, "lib/tasks.ts"), "utf8");
      const plannerOriginal = await readFile(path.join(root, "lib/planner.ts"), "utf8");

      let writes = 0;
      const result = await applyProposal({
        projectRoot: root,
        proposal: proposal({
          files: [
            { path: "lib/tasks.ts", change: "modify", summary: "Add a field." },
            { path: "lib/planner.ts", change: "modify", summary: "Add a constant." },
          ],
          diff: `${TASKS_DIFF}\n${SECOND_DIFF}`,
          snapshot: [
            { path: "lib/tasks.ts", sha256: sha256(tasksOriginal) },
            { path: "lib/planner.ts", sha256: sha256(plannerOriginal) },
          ],
        }),
        writeFileImpl: async (absolute, content) => {
          writes += 1;
          if (writes === 2) throw new Error("simulated disk failure");
          await writeFile(absolute, content, "utf8");
        },
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.failure.code, "io_error");
      assert.equal(result.rolledBack, true);
      assert.equal(await readFile(path.join(root, "lib/tasks.ts"), "utf8"), tasksOriginal);
      assert.equal(await readFile(path.join(root, "lib/planner.ts"), "utf8"), plannerOriginal);
    });
  });

  it("captures a snapshot of the current file contents", async () => {
    await withProject(async (root) => {
      const captured = await captureProposalSnapshot(root, proposal({ diff: TASKS_DIFF }));
      assert.deepEqual(captured.snapshot, [{ path: "lib/tasks.ts", sha256: sha256(TASKS_TEMPLATE) }]);
    });
  });
});

describe("code approval gate", () => {
  async function fixtureWorkflowAtCodeApproval(root: string, store: ReturnType<typeof createWorkflowStore>) {
    const created = await startWorkflow({
      feature: "Add a source field to tasks",
      fixture: true,
      store,
    });
    if (!created.ok) throw new Error("setup failed");

    const approved = await approveWorkflowPlan({ id: created.value.id, store });
    if (!approved.ok) throw new Error("setup failed");

    const proposed = await requestCodeProposal({
      id: created.value.id,
      store,
      useFixture: true,
      projectRoot: root,
    });
    if (!proposed.ok) throw new Error("setup failed");

    return proposed.value;
  }

  it("requires explicit confirmation before writing", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await fixtureWorkflowAtCodeApproval(root, store);
        const before = await readFile(path.join(root, "lib/tasks.ts"), "utf8");

        const result = await approveCodeProposal({ id: workflow.id, store, projectRoot: root });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.status, 400);

        assert.equal(await readFile(path.join(root, "lib/tasks.ts"), "utf8"), before);
      });
    });
  });

  it("applies the fixture proposal and moves to verifying", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await fixtureWorkflowAtCodeApproval(root, store);
        const before = await readFile(path.join(root, "lib/tasks.ts"), "utf8");

        const result = await approveCodeProposal({
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
        });

        assert.equal(result.ok, true);
        if (!result.ok) return;

        assert.equal(result.value.status, "verifying");
        assert.equal(result.value.history.at(-1)?.actor, "human");
        assert.match(result.value.history.at(-1)?.note ?? "", /Applied 1 file\(s\): lib\/tasks\.ts/);

        const after = await readFile(path.join(root, "lib/tasks.ts"), "utf8");
        assert.notEqual(after, before);
        assert.match(after, /source\?: string;/);
      });
    });
  });

  it("keeps the fixture label after the code is applied", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await fixtureWorkflowAtCodeApproval(root, store);
        const result = await approveCodeProposal({
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
        });
        assert.equal(result.ok, true);
        if (!result.ok) return;

        assert.equal(result.value.proposal?.source, "fixture");
        assert.equal(result.value.proposal?.model, undefined);
        assert.match(result.value.proposal?.notice ?? "", /not by an AI model/);
      });
    });
  });

  it("refuses approval in every other state", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const created = await startWorkflow({ feature: "Add a source field to tasks", fixture: true, store });
        if (!created.ok) throw new Error("setup failed");

        // awaiting_plan_approval
        const early = await approveCodeProposal({
          id: created.value.id,
          store,
          projectRoot: root,
          confirm: true,
        });
        assert.equal(early.ok, false);
        if (!early.ok) assert.equal(early.status, 409);

        // coding
        const approved = await approveWorkflowPlan({ id: created.value.id, store });
        assert.equal(approved.ok, true);
        const duringCoding = await approveCodeProposal({
          id: created.value.id,
          store,
          projectRoot: root,
          confirm: true,
        });
        assert.equal(duringCoding.ok, false);
        if (!duringCoding.ok) assert.equal(duringCoding.status, 409);

        // unknown
        const missing = await approveCodeProposal({ id: "wf_missing", store, confirm: true });
        assert.equal(missing.ok, false);
        if (!missing.ok) assert.equal(missing.status, 404);
      });
    });
  });

  it("ignores forged client status, actor and proposal", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await fixtureWorkflowAtCodeApproval(root, store);

        const forged = {
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
          status: "verifying",
          actor: "system",
          proposal: { id: "prop_forged", diff: "--- a/lib/tasks.ts\n+++ b/lib/tasks.ts\n@@ -1 +1 @@\n-x\n+y\n" },
        } as unknown as Parameters<typeof approveCodeProposal>[0];

        const result = await approveCodeProposal(forged);
        assert.equal(result.ok, true);
        if (!result.ok) return;

        assert.equal(result.value.history.at(-1)?.actor, "human");
        assert.equal(result.value.proposal?.id, workflow.proposal?.id);
        assert.notEqual(result.value.proposal?.id, "prop_forged");
      });
    });
  });

  it("reports a stale proposal as a conflict and writes nothing", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await fixtureWorkflowAtCodeApproval(root, store);
        const target = path.join(root, "lib/tasks.ts");

        await writeFile(target, `${await readFile(target, "utf8")}// edited later\n`, "utf8");
        const before = await readFile(target, "utf8");

        const result = await approveCodeProposal({
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
        });

        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.status, 409);
        assert.equal(await readFile(target, "utf8"), before);
        assert.equal((await store.get(workflow.id))?.status, "awaiting_code_approval");
      });
    });
  });

  it("rejects code with a reason and records the decision", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await fixtureWorkflowAtCodeApproval(root, store);
        const before = await readFile(path.join(root, "lib/tasks.ts"), "utf8");

        const rejected = await rejectCodeProposal({
          id: workflow.id,
          reason: "The diff changes more than the plan asked for.",
          store,
        });

        assert.equal(rejected.ok, true);
        if (!rejected.ok) return;
        assert.equal(rejected.value.status, "rejected");
        assert.equal(rejected.value.history.at(-1)?.actor, "human");
        assert.match(rejected.value.history.at(-1)?.note ?? "", /more than the plan/);
        assert.equal(await readFile(path.join(root, "lib/tasks.ts"), "utf8"), before);
      });
    });
  });

  it("requires a rejection reason and a rejection-eligible state", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const created = await startWorkflow({ feature: "Add a source field to tasks", fixture: true, store });
        if (!created.ok) throw new Error("setup failed");

        const wrongState = await rejectCodeProposal({
          id: created.value.id,
          reason: "Not yet.",
          store,
        });
        assert.equal(wrongState.ok, false);
        if (!wrongState.ok) assert.equal(wrongState.status, 409);

        const approved = await approveWorkflowPlan({ id: created.value.id, store });
        if (!approved.ok) throw new Error("setup failed");
        const proposed = await requestCodeProposal({
          id: created.value.id,
          store,
          useFixture: true,
          projectRoot: root,
        });
        if (!proposed.ok) throw new Error("setup failed");

        const blank = await rejectCodeProposal({ id: created.value.id, reason: "   ", store });
        assert.equal(blank.ok, false);
        if (!blank.ok) assert.equal(blank.status, 400);
      });
    });
  });

  it("does not write anything before approval", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await fixtureWorkflowAtCodeApproval(root, store);
        assert.equal(
          await readFile(path.join(root, "lib/tasks.ts"), "utf8"),
          TASKS_TEMPLATE,
          "requesting a proposal must not modify files",
        );
        assert.equal(workflow.status, "awaiting_code_approval");
      });
    });
  });
});