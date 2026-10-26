import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkflowStore, isValidWorkflowId } from "../lib/workflow-store.ts";
import {
  approveWorkflowPlan,
  readWorkflow,
  rejectWorkflowPlan,
  startWorkflow,
} from "../lib/workflow-service.ts";
import { createWorkflow } from "../lib/workflow.ts";

async function withTempStore<T>(
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

function sampleWorkflow(id: string) {
  const created = createWorkflow({ id, featureRequest: "Add due dates to tasks", now: 1_000 });
  if (!created.ok) throw new Error("sample workflow could not be created");
  return created.value;
}

describe("workflow store", () => {
  it("saves a workflow and reads it back", async () => {
    await withTempStore(async (store) => {
      const workflow = sampleWorkflow("wf_save1");
      await store.save(workflow);

      const loaded = await store.get("wf_save1");
      assert.ok(loaded);
      assert.equal(loaded.id, "wf_save1");
      assert.equal(loaded.featureRequest, "Add due dates to tasks");
      assert.equal(loaded.status, "planning");
    });
  });

  it("persists to disk so a new store instance sees the same record", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "statesleuth-store-"));
    try {
      const first = createWorkflowStore(dir);
      await first.save(sampleWorkflow("wf_durable"));

      const second = createWorkflowStore(dir);
      const loaded = await second.get("wf_durable");
      assert.ok(loaded, "a fresh store instance should read the saved workflow");
      assert.equal(loaded.status, "planning");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for an unknown or invalid id", async () => {
    await withTempStore(async (store) => {
      assert.equal(await store.get("wf_missing"), null);
      assert.equal(await store.get("../escape"), null);
      assert.equal(await store.get(""), null);
    });
  });

  it("rejects an id that is not safe to use as a filename", () => {
    assert.equal(isValidWorkflowId("wf_abc-123"), true);
    assert.equal(isValidWorkflowId("../escape"), false);
    assert.equal(isValidWorkflowId("has space"), false);
    assert.equal(isValidWorkflowId("a/b"), false);
    assert.equal(isValidWorkflowId(""), false);
    assert.equal(isValidWorkflowId(42), false);
  });

  it("refuses to save a workflow with an invalid id", async () => {
    await withTempStore(async (store) => {
      const workflow = { ...sampleWorkflow("wf_ok"), id: "../escape" };
      await assert.rejects(() => store.save(workflow));
    });
  });

  it("lists saved workflows newest first", async () => {
    await withTempStore(async (store) => {
      const older = { ...sampleWorkflow("wf_older"), createdAt: 1_000 };
      const newer = { ...sampleWorkflow("wf_newer"), createdAt: 5_000 };
      await store.save(older);
      await store.save(newer);

      const all = await store.list();
      assert.equal(all.length, 2);
      assert.equal(all[0]?.id, "wf_newer");
    });
  });

  it("returns an empty list when the directory does not exist", async () => {
    const store = createWorkflowStore(path.join(tmpdir(), "statesleuth-does-not-exist-xyz"));
    assert.deepEqual(await store.list(), []);
  });

  it("ignores a corrupt file instead of throwing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "statesleuth-store-"));
    try {
      const store = createWorkflowStore(dir);
      await store.save(sampleWorkflow("wf_good"));

      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "wf_bad.json"), "{not json", "utf8");

      assert.ok(await store.get("wf_good"));
      assert.equal(await store.get("wf_bad"), null);
      const all = await store.list();
      assert.equal(all.length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes a workflow", async () => {
    await withTempStore(async (store) => {
      await store.save(sampleWorkflow("wf_remove"));
      assert.equal(await store.remove("wf_remove"), true);
      assert.equal(await store.get("wf_remove"), null);
    });
  });
});

describe("workflow service", () => {
  it("rejects a feature request that is too short", async () => {
    await withTempStore(async (store) => {
      const result = await startWorkflow({ feature: "hi", store });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 400);
        assert.match(result.error, /at least/);
      }
    });
  });

  it("rejects a feature request that is too long", async () => {
    await withTempStore(async (store) => {
      const result = await startWorkflow({ feature: "a".repeat(2_500), store });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 400);
    });
  });

  it("creates a workflow, plans it, and stores it awaiting approval", async () => {
    await withTempStore(async (store) => {
      const result = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.status, "awaiting_plan_approval");
      assert.ok(result.value.plan, "the workflow should carry a plan");
      assert.equal(result.value.plan?.mode, "demo");
      assert.ok(result.value.plan?.plan.implementationSteps.length > 0);
      assert.equal(result.value.history.length, 2);
      assert.equal(result.value.history[1]?.actor, "planning_agent");

      const stored = await store.get(result.value.id);
      assert.ok(stored, "the workflow should have been written to the store");
      assert.equal(stored.status, "awaiting_plan_approval");
    });
  });

  it("reads a stored workflow and reports a missing one", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add a search box that filters tasks by title.",
        store,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;

      const read = await readWorkflow(created.value.id, store);
      assert.equal(read.ok, true);
      if (read.ok) assert.equal(read.value.id, created.value.id);

      const missing = await readWorkflow("wf_nope", store);
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.equal(missing.status, 404);
    });
  });

  it("approves a plan and moves the workflow to coding", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");

      const approved = await approveWorkflowPlan({ id: created.value.id, store });
      assert.equal(approved.ok, true);
      if (!approved.ok) return;

      assert.equal(approved.value.status, "coding");
      assert.equal(approved.value.history.at(-1)?.actor, "human");

      const stored = await store.get(created.value.id);
      assert.equal(stored?.status, "coding");
    });
  });

  it("refuses a second approval as an illegal transition", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");

      const first = await approveWorkflowPlan({ id: created.value.id, store });
      assert.equal(first.ok, true);

      const second = await approveWorkflowPlan({ id: created.value.id, store });
      assert.equal(second.ok, false);
      if (!second.ok) {
        assert.equal(second.status, 409);
        assert.equal(second.failure?.code, "invalid_transition");
      }
    });
  });

  it("rejects a plan with a reason and becomes terminal", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");

      const rejected = await rejectWorkflowPlan({
        id: created.value.id,
        reason: "The plan does not cover an already-overdue task.",
        store,
      });
      assert.equal(rejected.ok, true);
      if (!rejected.ok) return;

      assert.equal(rejected.value.status, "rejected");
      assert.equal(rejected.value.history.at(-1)?.actor, "human");
      assert.match(rejected.value.history.at(-1)?.note ?? "", /already-overdue/);
    });
  });

  it("requires a rejection reason", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");

      const result = await rejectWorkflowPlan({ id: created.value.id, reason: "  ", store });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 400);
        assert.match(result.error, /rejection reason/i);
      }
    });
  });

  it("refuses to approve a rejected workflow", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");

      await rejectWorkflowPlan({
        id: created.value.id,
        reason: "Wrong direction entirely.",
        store,
      });

      const approved = await approveWorkflowPlan({ id: created.value.id, store });
      assert.equal(approved.ok, false);
      if (!approved.ok) assert.equal(approved.status, 409);
    });
  });

  it("reports 404 for an unknown workflow", async () => {
    await withTempStore(async (store) => {
      const approved = await approveWorkflowPlan({ id: "wf_missing", store });
      assert.equal(approved.ok, false);
      if (!approved.ok) assert.equal(approved.status, 404);

      const rejected = await rejectWorkflowPlan({
        id: "wf_missing",
        reason: "Because.",
        store,
      });
      assert.equal(rejected.ok, false);
      if (!rejected.ok) assert.equal(rejected.status, 404);
    });
  });
});
