import { useState, type FormEvent } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Bot } from "@/state/store";
import type { WorkflowTask } from "../../shared/workflow";

const control =
  "rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
export type NewWorkflowTask = Pick<
  WorkflowTask,
  "title" | "input" | "priority" | "targetBotId"
>;

export function WorkflowTasks({
  bots,
  tasks,
  enabled,
  busy,
  workflowReady,
  onAdd,
  onRetry,
  onDelete,
  onOpen,
}: {
  bots: Bot[];
  tasks: WorkflowTask[];
  enabled: boolean;
  busy: boolean;
  workflowReady: boolean;
  onAdd(task: NewWorkflowTask): Promise<boolean>;
  onRetry(id: string): void;
  onDelete(id: string): void;
  onOpen(task: WorkflowTask): void;
}) {
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("");
  const [target, setTarget] = useState("");
  const [priority, setPriority] = useState<WorkflowTask["priority"]>("normal");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(true);
  const pending = tasks.filter((task) => task.status === "queued").length;
  async function add(event: FormEvent) {
    event.preventDefault();
    if (
      await onAdd({
        title,
        input,
        priority,
        ...(target ? { targetBotId: target } : {}),
      })
    ) {
      setTitle("");
      setInput("");
      setShowForm(false);
    }
  }
  const visible = tasks.filter(
    (task) =>
      filter === "all" ||
      (filter === "active"
        ? task.status === "queued" || task.status === "running"
        : task.status === filter),
  );
  return (
    <section
      aria-label="Task manager"
      className="min-w-0 flex-1 overflow-auto p-6 max-md:p-4"
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Task manager</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">
            Add work for one bot or the whole workflow. Tasks run one at a time,
            highest priority first; workflow branches still run in parallel.
          </p>
        </div>
        <p role="status" className="text-sm text-ink-secondary">
          {enabled
            ? "Queue enabled"
            : "Queue paused · Enable workflow to start"}{" "}
          · {pending} queued
        </p>
      </div>
      {showForm && (
        <form
          onSubmit={(event) => void add(event)}
          className="mb-8 rounded-xl border border-hairline/60 bg-panel p-5"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">New task</h3>
            <button
              type="button"
              className="text-xs text-ink-secondary underline"
              onClick={() => setShowForm(false)}
            >
              Hide form
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="text-xs text-ink-secondary">
              Task title
              <input
                required
                maxLength={160}
                className={`${control} mt-2 w-full`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Review the checkout flow"
              />
            </label>
            <label className="text-xs text-ink-secondary">
              Assign to
              <select
                className={`${control} mt-2 w-full`}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Entire workflow</option>
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-secondary">
              Priority
              <select
                className={`${control} mt-2 w-full`}
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as WorkflowTask["priority"])
                }
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
          <label className="mt-4 block text-xs text-ink-secondary">
            Task instructions
            <textarea
              required
              maxLength={12000}
              className={`${control} mt-2 min-h-24 w-full resize-y`}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Describe the goal, project context and expected result."
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-secondary">
              {!target && !workflowReady
                ? "Save workflow steps and a lead bot, or assign a bot directly."
                : "Progress, outputs and errors also go to your connected Telegram chat."}
            </p>
            <button
              type="submit"
              className={control}
              disabled={
                busy ||
                !title.trim() ||
                !input.trim() ||
                (!target && !workflowReady)
              }
            >
              <Plus size={14} className="mr-2 inline" />
              Add task
            </button>
          </div>
        </form>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          Tasks{" "}
          <span className="ml-1 font-normal text-ink-secondary">
            {tasks.length}
          </span>
        </h3>
        <div className="flex items-center gap-3">
          {!showForm && (
            <button className={`${control} shrink-0 whitespace-nowrap`} onClick={() => setShowForm(true)}>
              <Plus size={14} className="mr-2 inline" />
              New task
            </button>
          )}
          <label className="text-xs text-ink-secondary">
            Show
            <select
              className={`${control} ml-2`}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All tasks</option>
              <option value="active">Queued & running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="interrupted">Interrupted</option>
            </select>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-hairline/60">
        <table className="w-full min-w-[700px] text-left text-sm">
          <caption className="sr-only">
            Bot tasks and their execution results
          </caption>
          <thead className="bg-panel text-xs text-ink-secondary">
            <tr>
              {[
                "Task",
                "Assigned to",
                "Priority",
                "Status",
                "Result & actions",
              ].map((label) => (
                <th key={label} scope="col" className="px-4 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((task) => (
              <tr
                key={task.id}
                className="border-t border-hairline/40 align-top"
              >
                <td className="max-w-80 px-4 py-4">
                  <div className="break-words font-medium">{task.title}</div>
                  <div className="mt-1 text-xs text-ink-secondary">
                    {task.source === "telegram" ? "Telegram" : task.source === "bot" ? `Bot · ${bots.find(bot => bot.id === task.createdByBotId)?.name ?? task.createdByBotId}` : "App"} ·{" "}
                    {new Date(task.createdAt).toLocaleString()}
                  </div>
                </td>
                <td className="px-4 py-4">
                  {task.targetBotId
                    ? (bots.find((bot) => bot.id === task.targetBotId)?.name ??
                      "Unavailable bot")
                    : "Entire workflow"}
                </td>
                <td className="px-4 py-4 capitalize">{task.priority}</td>
                <td className="px-4 py-4">
                  <span
                    className={`inline-flex rounded-md px-2 py-1 text-xs capitalize ${task.status === "failed" || task.status === "interrupted" ? "bg-danger/10 text-danger" : task.status === "running" ? "bg-accent/10 text-accent-text" : "bg-panel text-ink-secondary"}`}
                  >
                    {task.status}
                  </span>
                </td>
                <td className="max-w-md px-4 py-4">
                  <div className="flex flex-wrap gap-3 text-xs">
                    {task.threadId && (
                      <button
                        className="text-accent-text underline"
                        onClick={() => onOpen(task)}
                      >
                        Open conversation
                      </button>
                    )}
                    {(task.status === "failed" ||
                      task.status === "interrupted") && (
                      <button
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-accent-text underline disabled:opacity-50"
                        aria-label={`Retry ${task.title}`}
                        onClick={() => onRetry(task.id)}
                      >
                        <RotateCcw size={12} />
                        Retry
                      </button>
                    )}
                    {task.status !== "running" && (
                      <button
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-ink-secondary underline disabled:opacity-50"
                        aria-label={`Remove ${task.title}`}
                        onClick={() => onDelete(task.id)}
                      >
                        <Trash2 size={12} />
                        {task.status === "queued" ? "Cancel" : "Remove"}
                      </button>
                    )}
                  </div>
                  <details className="mt-2 text-xs text-ink-secondary">
                    <summary className="cursor-pointer">
                      {task.result || task.error
                        ? "View output & instructions"
                        : "View instructions"}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {task.input}
                    </p>
                    {task.error && (
                      <p className="mt-3 whitespace-pre-wrap break-words text-danger">
                        {task.error}
                      </p>
                    )}
                    {task.result && (
                      <p className="mt-3 whitespace-pre-wrap break-words">
                        {task.result}
                      </p>
                    )}
                  </details>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-12 text-center text-ink-secondary"
                >
                  {tasks.length
                    ? "No tasks match this filter."
                    : "Your task queue is empty. Add a task above, or send a command through Telegram."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
