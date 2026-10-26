"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  CheckIcon,
  ClipboardIcon,
  CrossIcon,
  PencilIcon,
  PlusIcon,
  RewindIcon,
  TrashIcon,
} from "@/components/icons";
import {
  TASKS_STORAGE_KEY,
  addTask,
  countCompleted,
  deleteTask,
  filterTasks,
  loadTasks,
  renameTask,
  saveTasks,
  toggleTask,
  type Task,
  type TaskFilter,
} from "@/lib/tasks";

const filters: { id: TaskFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
];

export function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const composerRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTasks(loadTasks(window.localStorage));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveTasks(window.localStorage, tasks);
  }, [hydrated, tasks]);

  useEffect(() => {
    if (!editingId) return;
    editorRef.current?.focus();
    editorRef.current?.select();
  }, [editingId]);

  const completedCount = countCompleted(tasks);
  const activeCount = tasks.length - completedCount;
  const counts: Record<TaskFilter, number> = {
    all: tasks.length,
    active: activeCount,
    completed: completedCount,
  };
  const visible = filterTasks(tasks, filter);
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setTasks((prev) => addTask(prev, title));
    setDraft("");
    composerRef.current?.focus();
  }

  function handleToggle(id: string) {
    setTasks((prev) => toggleTask(prev, id));
  }

  function startEditing(task: Task) {
    setEditingId(task.id);
    setEditingTitle(task.title);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingTitle("");
  }

  function commitEdit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!editingId) return;
    const title = editingTitle.trim();
    if (!title) {
      cancelEditing();
      return;
    }
    setTasks((prev) => renameTask(prev, editingId, title));
    cancelEditing();
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  function handleDelete(id: string) {
    setTasks((prev) => deleteTask(prev, id));
    if (editingId === id) cancelEditing();
  }

  function handleReset() {
    setTasks([]);
    setFilter("all");
    cancelEditing();
    try {
      window.localStorage.removeItem(TASKS_STORAGE_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }

  return (
    <div>
      <section
        aria-labelledby="board-heading"
        className="hairline-card overflow-hidden rounded-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline/80 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2">
            <ClipboardIcon className="size-4 text-verified" />
            <h2 id="board-heading" className="text-sm font-semibold text-ink">
              Task board
            </h2>
            <span className="rounded-full border border-hairline bg-canvas/60 px-2 py-0.5 font-mono text-[0.65rem] text-muted">
              {tasks.length}
            </span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-white/20 hover:text-ink"
          >
            <RewindIcon className="size-3" />
            Reset demo
          </button>
        </div>

        <form onSubmit={handleAdd} className="border-b border-hairline/80 px-4 py-4 sm:px-5">
          <label htmlFor="new-task-title" className="sr-only">
            Task title
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="new-task-title"
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={120}
              autoComplete="off"
              placeholder="What needs to happen?"
              className="h-11 flex-1 rounded-xl border border-hairline bg-canvas/70 px-3.5 text-sm text-ink transition-colors placeholder:text-muted/60 hover:border-white/15 focus:border-verified/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={draft.trim().length === 0}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-verified px-4 text-sm font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-verified/40 disabled:text-[#04110c]/60"
            >
              <PlusIcon className="size-4" />
              Add task
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-3 border-b border-hairline/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div
            role="group"
            aria-label="Filter tasks"
            className="inline-flex w-fit rounded-lg border border-hairline bg-canvas/60 p-0.5"
          >
            {filters.map((option) => {
              const selected = filter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  aria-pressed={selected}
                  className={`inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    selected
                      ? "bg-elevated text-ink shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {option.label}
                  <span
                    className={`font-mono text-[0.6rem] ${
                      selected ? "text-verified" : "text-muted/70"
                    }`}
                  >
                    {counts[option.id]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div
              className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="Tasks completed"
            >
              <div
                className="h-full rounded-full bg-verified transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted">
              <span className="text-ink">{completedCount}</span> of {tasks.length} complete
            </p>
          </div>
        </div>

        <p aria-live="polite" className="sr-only">
          {completedCount} of {tasks.length} tasks complete.
        </p>

        {!hydrated ? (
          <div className="px-5 py-12 text-center text-sm text-muted" aria-busy="true">
            Loading your board…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState filter={filter} hasTasks={tasks.length > 0} />
        ) : (
          <ul className="divide-y divide-hairline/70">
            {visible.map((task) => {
              const isEditing = editingId === task.id;
              return (
                <li
                  key={task.id}
                  className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.02] sm:px-5"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={task.completed}
                    aria-label={`Mark "${task.title}" as ${
                      task.completed ? "incomplete" : "complete"
                    }`}
                    onClick={() => handleToggle(task.id)}
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border transition-colors ${
                      task.completed
                        ? "border-verified bg-verified text-[#04110c]"
                        : "border-white/20 bg-canvas/60 text-transparent hover:border-verified/60"
                    }`}
                  >
                    <CheckIcon className="size-3.5" strokeWidth={2.5} />
                  </button>

                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <form onSubmit={commitEdit} className="flex flex-col gap-2 sm:flex-row">
                        <label htmlFor={`edit-${task.id}`} className="sr-only">
                          Edit task title
                        </label>
                        <input
                          id={`edit-${task.id}`}
                          ref={editorRef}
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={handleEditorKeyDown}
                          maxLength={120}
                          autoComplete="off"
                          className="h-9 flex-1 rounded-lg border border-verified/40 bg-canvas/80 px-2.5 text-sm text-ink focus:border-verified focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            className="h-9 rounded-lg bg-verified px-3 text-xs font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80]"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            className="inline-flex h-9 items-center gap-1 rounded-lg border border-hairline px-2.5 text-xs text-muted transition-colors hover:text-ink"
                          >
                            <CrossIcon className="size-3" />
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p
                        className={`break-words text-sm leading-relaxed ${
                          task.completed ? "text-muted line-through" : "text-ink"
                        }`}
                      >
                        {task.title}
                      </p>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEditing(task)}
                        aria-label={`Edit "${task.title}"`}
                        className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-ink"
                      >
                        <PencilIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(task.id)}
                        aria-label={`Delete "${task.title}"`}
                        className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-3 text-center text-xs text-muted">
        Stored in this browser under{" "}
        <code className="font-mono text-[0.7rem] text-muted/90">{TASKS_STORAGE_KEY}</code>. No
        account, server or API key involved.
      </p>
    </div>
  );
}

function EmptyState({ filter, hasTasks }: { filter: TaskFilter; hasTasks: boolean }) {
  const copy = !hasTasks
    ? {
        title: "No tasks yet",
        body: "Add the first task above. It will be here when you reload the page.",
      }
    : filter === "active"
      ? {
          title: "Nothing active",
          body: "Every task on this board is complete.",
        }
      : {
          title: "Nothing completed",
          body: "Mark a task complete and it will show up here.",
        };

  return (
    <div className="px-5 py-14 text-center">
      <div className="mx-auto grid size-10 place-items-center rounded-xl border border-hairline bg-canvas/60 text-muted">
        <ClipboardIcon className="size-5" />
      </div>
      <p className="mt-4 text-sm font-medium text-ink">{copy.title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">{copy.body}</p>
    </div>
  );
}