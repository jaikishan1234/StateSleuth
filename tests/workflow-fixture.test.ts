import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFixturePlan, FIXTURE_PLAN_NOTICE } from "../lib/planner.ts";
import { createWorkflowStore } from "../lib/workflow-store.ts";
import {
  approveWorkflowPlan,
  requestCodeProposal,
  startWorkflow,
} from "../lib/workflow-service.ts";
import { transition } from "../lib/workflow.ts";

const STUB_PLAN = {
  featureSummary: { title: "Stub plan", description: "A plan from the local stub." },
  implementationSteps: [
    { title: "Step one", detail: "Do the first thing." },
    { title: "Step two", detail: "Do the second thing." },
  ],
  acceptanceCriteria: ["Criterion one", "Criterion two"],
  browserVerificationSteps: ["Open the page", "Reload the page"],
  expectedResults: ["Result one", "Result two"],
  edgeCases: ["Edge one", "Edge two"],
};

type StubState = { hits: number; fail: boolean };

async function startStub(): Promise<{
  state: StubState;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const state: StubState = { hits: 0, fail: false };

  const server = createServer((request, response) => {
    state.hits += 1;
    request.resume();
    request.on("end", () => {
      if (state.fail) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end('{"error":{"message":"stub unavailable"}}');
        return;
      }
      const content = JSON.stringify(STUB_PLAN);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    state,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const FEATURE = "Add due dates to tasks and highlight the ones that are overdue.";

async function withTempStore<T>(
  run: (store: ReturnType<typeof createWorkflowStore>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "statesleuth-fixture-"));
  const store = createWorkflowStore(dir);
  try {
    return await run(store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("fixture-mode workflow creation", () => {
  let stub: Awaited<ReturnType<typeof startStub>>;

  before(async () => {
    stub = await startStub();
  });

  after(async () => {
    delete process.env.PLANNER_API_KEY;
    delete process.env.PLANNER_BASE_URL;
    delete process.env.PLANNER_MODEL;
    await stub.close();
  });

  beforeEach(() => {
    stub.state.hits = 0;
    stub.state.fail = false;
    process.env.PLANNER_API_KEY = "test-key-not-real";
    process.env.PLANNER_BASE_URL = stub.baseUrl;
    process.env.PLANNER_MODEL = "stub-model";
  });

  it("creates a fixture workflow without calling the provider", async () => {
    await withTempStore(async (store) => {
      const result = await startWorkflow({ feature: FEATURE, fixture: true, store });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(stub.state.hits, 0, "no model request may be made in fixture mode");
      assert.equal(result.value.status, "awaiting_plan_approval");
      assert.equal(result.value.plan?.mode, "fixture");
      assert.equal(result.value.history.length, 2);
      assert.equal(result.value.history[1]?.actor, "planning_agent");
    });
  });

  it("labels the fixture plan as a fixture, not AI output", async () => {
    await withTempStore(async (store) => {
      const result = await startWorkflow({ feature: FEATURE, fixture: true, store });
      if (!result.ok) throw new Error("setup failed");

      const plan = result.value.plan;
      assert.equal(plan?.mode, "fixture");
      assert.notEqual(plan?.mode, "live");
      assert.match(plan?.plan.featureSummary.description ?? "", /Test fixture plan/);
      assert.match(plan?.plan.featureSummary.description ?? "", /not AI-generated/);
      assert.equal(
        buildFixturePlan(FEATURE).featureSummary.description.includes("Test fixture plan"),
        true,
      );
      assert.match(FIXTURE_PLAN_NOTICE, /not by an AI model/);
    });
  });

  it("still calls the configured provider in normal mode", async () => {
    await withTempStore(async (store) => {
      const result = await startWorkflow({ feature: FEATURE, store });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(stub.state.hits, 1, "normal mode must reach the provider");
      assert.equal(result.value.plan?.mode, "live");
      assert.equal(result.value.plan?.plan.featureSummary.title, "Stub plan");
    });
  });

  it("treats an explicit false fixture as normal mode", async () => {
    await withTempStore(async (store) => {
      const result = await startWorkflow({ feature: FEATURE, fixture: false, store });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(stub.state.hits, 1);
      assert.equal(result.value.plan?.mode, "live");
    });
  });

  it("does not fall back to a fixture when the provider fails", async () => {
    await withTempStore(async (store) => {
      stub.state.fail = true;

      const result = await startWorkflow({ feature: FEATURE, store });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 502);
      assert.match(result.error, /No demo or fixture plan was substituted/);
      assert.equal(stub.state.hits, 1);
    });
  });

  it("stores a failed workflow when the provider fails, with no plan", async () => {
    await withTempStore(async (store) => {
      stub.state.fail = true;

      const result = await startWorkflow({ feature: FEATURE, store });
      assert.equal(result.ok, false);

      const all = await store.list();
      assert.equal(all.length, 1);
      assert.equal(all[0]?.status, "failed");
      assert.equal(all[0]?.plan, undefined);
      assert.match(all[0]?.failure?.message ?? "", /No demo or fixture plan/);
    });
  });

  it("rejects a fixture value that is not a boolean", async () => {
    await withTempStore(async (store) => {
      for (const value of ["true", 1, 0, null, {}, []]) {
        const result = await startWorkflow({ feature: FEATURE, fixture: value, store });
        assert.equal(result.ok, false, `fixture=${JSON.stringify(value)} must be rejected`);
        if (!result.ok) {
          assert.equal(result.status, 400);
          assert.match(result.error, /must be true or false/);
        }
      }

      assert.equal(stub.state.hits, 0, "an invalid request must not reach the provider");
      assert.equal((await store.list()).length, 0, "an invalid request must not create a workflow");
    });
  });

  it("ignores privileged client fields when creating a workflow", async () => {
    await withTempStore(async (store) => {
      const forged = {
        feature: FEATURE,
        fixture: true,
        status: "passed",
        actor: "system",
        proposal: { id: "prop_forged" },
        plan: { id: "plan_forged" },
        history: [],
        store,
      } as unknown as Parameters<typeof startWorkflow>[0];

      const result = await startWorkflow(forged);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.status, "awaiting_plan_approval");
      assert.notEqual(result.value.plan?.id, "plan_forged");
      assert.equal(result.value.proposal, undefined);
      assert.equal(result.value.history.length, 2);
      assert.equal(result.value.history[0]?.actor, "system");
      assert.equal(result.value.history[1]?.actor, "planning_agent");
    });
  });

  it("keeps the human approval and proposal guards after a fixture plan", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({ feature: FEATURE, fixture: true, store });
      if (!created.ok) throw new Error("setup failed");

      // Coding is unreachable before plan approval.
      const early = await requestCodeProposal({
        id: created.value.id,
        store,
        useFixture: true,
      });
      assert.equal(early.ok, false);
      if (!early.ok) assert.equal(early.status, 409);

      const approved = await approveWorkflowPlan({ id: created.value.id, store });
      assert.equal(approved.ok, true);
      if (!approved.ok) return;
      assert.equal(approved.value.status, "coding");

      // A workflow cannot wait for code approval without a proposal.
      const noProposal = transition(approved.value, "awaiting_code_approval", {
        actor: "coding_agent",
      });
      assert.equal(noProposal.ok, false);
      if (!noProposal.ok) assert.equal(noProposal.failure.code, "proposal_required");

      const proposal = await requestCodeProposal({
        id: created.value.id,
        store,
        useFixture: true,
      });
      assert.equal(proposal.ok, true);
      if (!proposal.ok) return;
      assert.equal(proposal.value.status, "awaiting_code_approval");
      assert.equal(proposal.value.proposal?.source, "fixture");
      assert.equal(stub.state.hits, 0, "the whole fixture journey must stay offline");
    });
  });
});