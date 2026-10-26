/**
 * File-backed workflow storage.
 *
 * Server-only: uses node:fs and must never be imported from a client
 * component.
 *
 * Scope and limitations (deliberate, for a single-user local demo):
 * - Workflows are stored as one JSON file per workflow under `.data/workflows`
 *   inside the project root, so they DO survive a server restart. This is
 *   durable local disk storage, not a database.
 * - There is no database, no migration layer and no indexing. Reads scan the
 *   directory.
 * - Writes are atomic per file (write to a temporary file, then rename), but
 *   there is no cross-file transaction and no locking. Two concurrent writers
 *   to the same workflow id can lose an update. This is acceptable for one
 *   local user, and is not safe for a multi-process or multi-user deployment.
 * - The directory is local to this machine. Nothing is encrypted, and no
 *   authentication guards the files.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Workflow } from "./workflow.ts";

export const DEFAULT_WORKFLOW_DIR = path.join(process.cwd(), ".data", "workflows");

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidWorkflowId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isWorkflowRecord(value: unknown): value is Workflow {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.featureRequest === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number" &&
    Array.isArray(candidate.history)
  );
}

export type WorkflowStore = {
  save(workflow: Workflow): Promise<void>;
  get(id: string): Promise<Workflow | null>;
  list(): Promise<Workflow[]>;
  remove(id: string): Promise<boolean>;
};

export function createWorkflowStore(
  dir: string = DEFAULT_WORKFLOW_DIR,
): WorkflowStore {
  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  function fileFor(id: string): string {
    return path.join(dir, `${id}.json`);
  }

  return {
    async save(workflow: Workflow): Promise<void> {
      if (!isValidWorkflowId(workflow.id)) {
        throw new Error("Refusing to store a workflow with an invalid id.");
      }
      await ensureDir();

      const target = fileFor(workflow.id);
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(workflow, null, 2), "utf8");
      await rename(temporary, target);
    },

    async get(id: string): Promise<Workflow | null> {
      if (!isValidWorkflowId(id)) return null;
      try {
        const raw = await readFile(fileFor(id), "utf8");
        const parsed: unknown = JSON.parse(raw);
        return isWorkflowRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },

    async list(): Promise<Workflow[]> {
      let entries: string[];
      try {
        // turbopackIgnore: the directory is a fixed subfolder of the project
        // (.data/workflows), not a traced project-wide path.
        entries = await readdir(/* turbopackIgnore: true */ dir);
      } catch {
        return [];
      }

      const workflows: Workflow[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const workflow = await this.get(entry.slice(0, -".json".length));
        if (workflow) workflows.push(workflow);
      }
      return workflows.sort((left, right) => right.createdAt - left.createdAt);
    },

    async remove(id: string): Promise<boolean> {
      if (!isValidWorkflowId(id)) return false;
      try {
        await rm(fileFor(id), { force: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Process-wide store instance used by the route handlers. */
let sharedStore: WorkflowStore | null = null;

export function getWorkflowStore(): WorkflowStore {
  if (!sharedStore) sharedStore = createWorkflowStore();
  return sharedStore;
}

/** Test seam: point the shared store at a different directory. */
export function setWorkflowStore(store: WorkflowStore | null): void {
  sharedStore = store;
}
