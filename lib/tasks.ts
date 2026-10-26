/**
 * Task domain logic for the demo board.
 *
 * Kept free of React and storage APIs so the same functions can be exercised by
 * the future verification engine without mounting the UI.
 */

export type Task = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
};

export type TaskFilter = "all" | "active" | "completed";

export const TASKS_STORAGE_KEY = "statesleuth.tasks.v1";
export const MAX_TITLE_LENGTH = 120;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanTitle(title: string): string {
  return title.trim().slice(0, MAX_TITLE_LENGTH);
}

export function createTask(
  title: string,
  now: number = Date.now(),
  id: string = newId(),
): Task {
  return {
    id,
    title: cleanTitle(title),
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function addTask(tasks: Task[], title: string, now: number = Date.now()): Task[] {
  const trimmed = cleanTitle(title);
  if (!trimmed) return tasks;
  return [createTask(trimmed, now), ...tasks];
}

export function renameTask(
  tasks: Task[],
  id: string,
  title: string,
  now: number = Date.now(),
): Task[] {
  const trimmed = cleanTitle(title);
  if (!trimmed) return tasks;
  return tasks.map((task) =>
    task.id === id ? createTask(trimmed, now, task.id) : task,
  );
}

export function toggleTask(tasks: Task[], id: string, now: number = Date.now()): Task[] {
  return tasks.map((task) =>
    task.id === id ? { ...task, completed: !task.completed, updatedAt: now } : task,
  );
}

export function deleteTask(tasks: Task[], id: string): Task[] {
  return tasks.filter((task) => task.id !== id);
}

export function countCompleted(tasks: Task[]): number {
  return tasks.filter((task) => task.completed).length;
}

export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  if (filter === "active") return tasks.filter((task) => !task.completed);
  if (filter === "completed") return tasks.filter((task) => task.completed);
  return tasks;
}

function isStoredTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.completed === "boolean" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number"
  );
}

/** Parses persisted JSON, ignoring anything that is not a well-formed task. */
export function parseTasks(raw: string | null): Task[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredTask).map((task) => ({
      ...task,
      title: task.title.slice(0, MAX_TITLE_LENGTH),
    }));
  } catch {
    return [];
  }
}

export function loadTasks(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string = TASKS_STORAGE_KEY,
): Task[] {
  if (!storage) return [];
  try {
    return parseTasks(storage.getItem(key));
  } catch {
    return [];
  }
}

export function saveTasks(
  storage: Pick<Storage, "setItem"> | undefined,
  tasks: Task[],
  key: string = TASKS_STORAGE_KEY,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(tasks));
  } catch {
    // Storage can be unavailable (private mode, quota). The board still works
    // for the current session.
  }
}