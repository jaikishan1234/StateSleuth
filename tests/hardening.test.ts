import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { CodingProposal } from "../lib/coding-proposal.ts";
import { validateProposal } from "../lib/coding-proposal.ts";
import { PERMITTED_SOURCE_FILES, isPermittedSourceFile } from "../lib/coding-paths.ts";
import { checkLocalRequest } from "../lib/local-guard.ts";
import { applyProposal, sha256 } from "../lib/patch-apply.ts";
import { createWorkflowStore } from "../lib/workflow-store.ts";
import {
  approveCodeProposal,
  approveWorkflowPlan,
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

function makeProposal(filePath: string, diff: string, hash: string): CodingProposal {
  return {
    id: "prop_test",
    source: "fixture",
    explanation: "Test proposal.",
    files: [{ path: filePath, change: "modify", summary: "Edit the file." }],
    diff,
    createdAt: 1_000,
    snapshot: [{ path: filePath, sha256: hash }],
  };
}

const PLANNER_TEMPLATE = "export const A = 1;\n\n";

const SECOND_DIFF = [
  "--- a/lib/planner.ts",
  "+++ b/lib/planner.ts",
  "@@ -1,2 +1,3 @@",
  " export const A = 1;",
  "+export const B = 2;",
  " ",
].join("\n");

async function withProject<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "statesleuth-hardening-"));
  try {
    await mkdir(path.join(root, "lib"), { recursive: true });
    await writeFile(path.join(root, "lib", "tasks.ts"), TASKS_TEMPLATE, "utf8");
    await writeFile(path.join(root, "lib", "planner.ts"), PLANNER_TEMPLATE, "utf8");
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function twoFileProposal(): CodingProposal {
  return {
    id: "prop_two",
    source: "fixture",
    explanation: "Edit two files.",
    files: [
      { path: "lib/tasks.ts", change: "modify", summary: "Add a field." },
      { path: "lib/planner.ts", change: "modify", summary: "Add a constant." },
    ],
    diff: `${TASKS_DIFF}\n${SECOND_DIFF}`,
    createdAt: 1_000,
    snapshot: [
      { path: "lib/tasks.ts", sha256: sha256(TASKS_TEMPLATE) },
      { path: "lib/planner.ts", sha256: sha256(PLANNER_TEMPLATE) },
    ],
  };
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

async function atCodeApproval(
  root: string,
  store: ReturnType<typeof createWorkflowStore>,
) {
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

function requestWith(headers: Record<string, string>): Request {
  return { headers: new Headers(headers) } as unknown as Request;
}

describe("safety modules are outside the edit allowlist", () => {
  const protectedFiles = [
    "lib/coding-paths.ts",
    "lib/coding-proposal.ts",
    "lib/patch-apply.ts",
    "lib/workflow.ts",
    "lib/workflow-service.ts",
    "lib/workflow-store.ts",
    "lib/local-guard.ts",
  ];

  it("does not list any safety or workflow-integrity module", () => {
    for (const file of protectedFiles) {
      assert.equal(isPermittedSourceFile(file), false, `${file} must not be editable`);
      assert.equal(
        (PERMITTED_SOURCE_FILES as readonly string[]).includes(file),
        false,
        `${file} must not appear in the allowlist`,
      );
    }
  });

  it("still permits ordinary product files", () => {
    for (const file of ["lib/tasks.ts", "app/page.tsx", "components/icons.tsx"]) {
      assert.equal(isPermittedSourceFile(file), true, `${file} should remain editable`);
    }
  });

  it("drops the nonexistent fixture placeholder", () => {
    assert.equal(
      (PERMITTED_SOURCE_FILES as readonly string[]).includes("lib/coding-fixture.ts"),
      false,
    );
  });

  it("rejects a proposal that names a safety module", () => {
    const result = validateProposal(
      {
        explanation: "Weaken the path rules.",
        files: [{ path: "lib/coding-paths.ts", change: "modify", summary: "Relax it." }],
        diff: "--- a/lib/coding-paths.ts\n+++ b/lib/coding-paths.ts\n@@ -1 +1 @@\n-a\n+b\n",
      },
      { source: "live", id: "prop_bad", createdAt: 1 },
    );
    assert.equal(result.ok, false);
  });

  it("refuses to apply a proposal that targets a safety module", async () => {
    await withProject(async (root) => {
      await mkdir(path.join(root, "lib"), { recursive: true });
      await writeFile(path.join(root, "lib", "coding-paths.ts"), "export const x = 1;\n");
      const before = await readFile(path.join(root, "lib", "coding-paths.ts"), "utf8");

      const result = await applyProposal({
        projectRoot: root,
        proposal: makeProposal(
          "lib/coding-paths.ts",
          "--- a/lib/coding-paths.ts\n+++ b/lib/coding-paths.ts\n@@ -1 +1 @@\n-export const x = 1;\n+export const x = 2;\n",
          sha256(before),
        ),
      });

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.code, "invalid_proposal");
      assert.equal(await readFile(path.join(root, "lib", "coding-paths.ts"), "utf8"), before);
    });
  });
});

describe("local-only guard", () => {
  it("accepts loopback hosts", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "127.0.1.1", "[::1]:3000", "::1"]) {
      assert.equal(checkLocalRequest(requestWith({ host })).ok, true, host);
    }
  });

  it("rejects a non-loopback host", () => {
    for (const host of ["192.168.1.20:3000", "10.0.0.5", "example.com", "0.0.0.0:3000"]) {
      const result = checkLocalRequest(requestWith({ host }));
      assert.equal(result.ok, false, host);
    }
  });

  it("rejects a missing host header", () => {
    assert.equal(checkLocalRequest(requestWith({})).ok, false);
  });

  it("rejects a non-loopback forwarded client", () => {
    const result = checkLocalRequest(
      requestWith({ host: "localhost:3000", "x-forwarded-for": "203.0.113.9, 127.0.0.1" }),
    );
    assert.equal(result.ok, false);

    assert.equal(
      checkLocalRequest(requestWith({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1" })).ok,
      true,
    );
  });

  it("rejects a non-loopback origin and accepts a local one", () => {
    assert.equal(
      checkLocalRequest(requestWith({ host: "localhost:3000", origin: "https://evil.example" })).ok,
      false,
    );
    assert.equal(
      checkLocalRequest(requestWith({ host: "localhost:3000", origin: "http://localhost:3000" })).ok,
      true,
    );
    assert.equal(
      checkLocalRequest(requestWith({ host: "localhost:3000", origin: "not a url" })).ok,
      false,
    );
  });
});

describe("rollback reporting", () => {
  it("reports nothing applied when every file was restored", async () => {
    await withProject(async (root) => {
      let writes = 0;
      const result = await applyProposal({
        projectRoot: root,
        proposal: twoFileProposal(),
        writeFileImpl: async (absolute, content) => {
          writes += 1;
          // The second file fails to write; the rollback write succeeds.
          if (writes === 2) throw new Error("simulated failure on the second file");
          await writeFile(absolute, content, "utf8");
        },
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.rolledBack, true);
      assert.deepEqual(result.applied, [], "a complete rollback means nothing stays applied");
      assert.match(result.failure.message, /files are unchanged/);
      assert.equal(await readFile(path.join(root, "lib/tasks.ts"), "utf8"), TASKS_TEMPLATE);
      assert.equal(await readFile(path.join(root, "lib/planner.ts"), "utf8"), PLANNER_TEMPLATE);
    });
  });

  it("reports the file that could not be restored", async () => {
    await withProject(async (root) => {
      let writes = 0;
      const result = await applyProposal({
        projectRoot: root,
        proposal: twoFileProposal(),
        writeFileImpl: async () => {
          writes += 1;
          // First write succeeds, second fails, then the rollback write fails.
          if (writes >= 2) throw new Error("simulated failure");
        },
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.rolledBack, false);
      assert.deepEqual(result.applied, ["lib/tasks.ts"]);
      assert.match(result.failure.message, /could not be restored/);
    });
  });
});

describe("safe retry and failure reporting in the service", () => {
  it("keeps the workflow retryable when the write was rolled back", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await atCodeApproval(root, store);

        const rolledBack = await approveCodeProposal({
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
          applyImpl: async () => ({
            ok: false,
            failure: { code: "io_error", message: "Writing the patch failed. Every change was rolled back, so the files are unchanged." },
            applied: [],
            rolledBack: true,
          }),
        });

        assert.equal(rolledBack.ok, false);
        if (rolledBack.ok) return;
        assert.equal(rolledBack.filesChanged, false);
        assert.deepEqual(rolledBack.applied, []);
        assert.match(rolledBack.error, /retry/i);
        assert.equal((await store.get(workflow.id))?.status, "awaiting_code_approval");
      });
    });
  });

  it("allows a retry after a rolled-back failure", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await atCodeApproval(root, store);

        await approveCodeProposal({
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
          applyImpl: async () => ({
            ok: false,
            failure: { code: "io_error", message: "rolled back" },
            applied: [],
            rolledBack: true,
          }),
        });

        const retry = await approveCodeProposal({
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
        });

        assert.equal(retry.ok, true);
        if (!retry.ok) return;
        assert.equal(retry.value.status, "verifying");
        assert.match(await readFile(path.join(root, "lib/tasks.ts"), "utf8"), /source\?: string;/);
      });
    });
  });

  it("marks the workflow failed and reports files changed on an irreversible failure", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await atCodeApproval(root, store);

        const result = await approveCodeProposal({
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
          applyImpl: async () => ({
            ok: false,
            failure: { code: "io_error", message: "Restore failed." },
            applied: ["lib/tasks.ts"],
            rolledBack: false,
          }),
        });

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.filesChanged, true);
        assert.deepEqual(result.applied, ["lib/tasks.ts"]);

        const stored = await store.get(workflow.id);
        assert.equal(stored?.status, "failed");
        assert.match(stored?.history.at(-1)?.note ?? "", /changed and not restored/);
      });
    });
  });

  it("reports files changed when persistence fails after a successful write", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await atCodeApproval(root, store);

        const failingStore = {
          ...store,
          save: async (next: Parameters<typeof store.save>[0]) => {
            if (next.status === "verifying") throw new Error("simulated disk failure");
            await store.save(next);
          },
        };

        const result = await approveCodeProposal({
          id: workflow.id,
          store: failingStore,
          projectRoot: root,
          confirm: true,
        });

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.status, 500);
        assert.equal(result.filesChanged, true);
        assert.deepEqual(result.applied, ["lib/tasks.ts"]);
        assert.match(result.error, /Source files have already changed/);

        // The file really was written...
        assert.match(await readFile(path.join(root, "lib/tasks.ts"), "utf8"), /source\?: string;/);
        // ...while the persisted workflow still says it is awaiting approval.
        assert.equal((await store.get(workflow.id))?.status, "awaiting_code_approval");
      });
    });
  });

  it("does not report files changed when nothing was written", async () => {
    await withProject(async (root) => {
      await withStore(async (store) => {
        const workflow = await atCodeApproval(root, store);
        const target = path.join(root, "lib/tasks.ts");
        await writeFile(target, `${TASKS_TEMPLATE}// edited\n`, "utf8");

        const result = await approveCodeProposal({
          id: workflow.id,
          store,
          projectRoot: root,
          confirm: true,
        });

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.filesChanged, false);
        assert.deepEqual(result.applied, []);
        assert.equal((await store.get(workflow.id))?.status, "awaiting_code_approval");
      });
    });
  });
});
