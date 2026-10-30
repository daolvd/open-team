import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Play, Plus, Save, Trash2, X } from "lucide-react";
import { api, openThread, useStore, type Bot } from "@/state/store";
import { ConfirmDialog } from "./ConfirmDialog";
import { openBotSettings } from "./bot-panel/panel-link";
import type {
  WorkflowDocument,
  WorkflowEdge,
  WorkflowRun,
  WorkflowTask,
  WorkflowTelegramStatus,
} from "../../shared/workflow";
import { WorkflowTasks, type NewWorkflowTask } from "./WorkflowTasks";
import {
  WorkflowTelegramSettings,
  type WorkflowTelegramConfig,
} from "./WorkflowTelegramSettings";

type Snapshot = {
  workflow: WorkflowDocument;
  runs: WorkflowRun[];
  tasks: WorkflowTask[];
  telegram: WorkflowTelegramStatus;
};

const control =
  "rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-accent";
const empty: WorkflowDocument = {
  name: "Team workflow",
  enabled: false,
  leadBotId: "",
  nodes: [],
  edges: [],
};

export function WorkflowEditor({
  bots,
  onClose,
}: {
  bots: Bot[];
  onClose(): void;
}) {
  const { state, dispatch } = useStore();
  const [workflow, setWorkflow] = useState<WorkflowDocument>(empty);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [telegram, setTelegram] = useState<WorkflowTelegramStatus>({
    connected: false,
    state: "disconnected",
  });
  const [tab, setTab] = useState("flow");
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeIndex, setEdgeIndex] = useState<number | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [target, setTarget] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const connectedByDrag = useRef(false);
  const drag = useRef<{
    id: string;
    dx: number;
    dy: number;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void api<Snapshot>("/api/workflows")
      .then((data) => {
        if (active) {
          setWorkflow(data.workflow);
          setRuns(data.runs);
          setTasks(data.tasks);
          setTelegram(data.telegram);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const running =
    runs.some((run) => run.status === "running") ||
    tasks.some((task) => task.status === "running");
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    const timer = window.setInterval(() => {
      void api<Snapshot>("/api/workflows", { background: true })
        .then((data) => {
          if (active) {
            setRuns(data.runs);
            setTasks(data.tasks);
            setTelegram(data.telegram);
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loaded]);
  function change(next: WorkflowDocument) {
    setWorkflow(next);
    setDirty(true);
  }
  function changeConnection(next: WorkflowEdge) {
    change({ ...workflow, edges: workflow.edges.map((link, i) => i === edgeIndex ? next : link) });
  }
  function connect(from: string, to: string) {
    if (
      from === to ||
      workflow.edges.some((edge) => edge.from === from && edge.to === to)
    )
      return;
    change({ ...workflow, edges: [...workflow.edges, { from, to }] });
    setConnecting(null);
  }
  async function save(next = workflow) {
    setBusy(true);
    setError("");
    try {
      await api("/api/workflows", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setWorkflow(next);
      setDirty(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function taskRequest(
    path: string,
    method: string,
    body?: NewWorkflowTask,
  ) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/workflows/tasks${path}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await api<Snapshot>("/api/workflows");
      setTasks(data.tasks);
      setRuns(data.runs);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function telegramRequest(config?: WorkflowTelegramConfig) {
    setBusy(true);
    setError("");
    try {
      const status = await api<WorkflowTelegramStatus>(
        "/api/workflows/telegram",
        {
          method: config ? "PUT" : "DELETE",
          ...(config ? { body: JSON.stringify(config) } : {}),
        },
      );
      setTelegram(status);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ run: WorkflowRun }>("/api/workflows/run", {
        method: "POST",
        body: JSON.stringify({ input }),
      });
      setRuns((previous) => [data.run, ...previous].slice(0, 20));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const step = workflow.nodes.find((node) => node.id === selected);
  const edge = edgeIndex === null ? undefined : workflow.edges[edgeIndex];
  const latest = runs[0];
  function conversation(id: string, threadId: string) {
    openThread(dispatch, { botId: id, threadId }, state, true);
  }
  return (
    <>
      <ConfirmDialog
        open={leaving}
        title="Discard unsaved workflow changes?"
        body="Save your changes to keep the steps and connections you edited."
        confirmLabel="Discard changes"
        tone="neutral"
        onCancel={() => setLeaving(false)}
        onConfirm={onClose}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
        <header className="flex flex-wrap items-center gap-3 border-b border-hairline/40 px-6 py-4 max-md:pl-16">
          <button
            className={control}
            onClick={() => (dirty ? setLeaving(true) : onClose())}
          >
            <ArrowLeft size={16} aria-label="Back to team map" />
          </button>
          <div className="mr-auto min-w-0 flex-1 max-md:basis-[calc(100%-3.5rem)]">
            <h1 className="text-[17px] font-semibold">Workflow</h1>
            <p className="mt-1 text-xs text-ink-secondary max-md:hidden">
              Arrange steps, connect bots and route their results.
            </p>
          </div>
          <button
            className={`${control} disabled:opacity-50 ${workflow.enabled ? "border-accent text-accent-text" : ""}`}
            aria-pressed={workflow.enabled}
            disabled={!loaded || busy || dirty}
            onClick={() =>
              void save({ ...workflow, enabled: !workflow.enabled })
            }
          >
            {workflow.enabled ? "Disable workflow" : "Enable workflow"}
          </button>
          <button
            className={control}
            disabled={!loaded || busy || !dirty}
            onClick={() => void save()}
          >
            <Save size={14} className="mr-2 inline" />
            {dirty ? "Save changes" : "Saved"}
          </button>
        </header>
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between bg-danger/10 px-6 py-3 text-sm text-danger"
          >
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!loaded ? (
          <p className="p-6 text-sm text-ink-secondary">
            {error
              ? "Unable to load workflow. Reopen this tab to retry."
              : "Loading workflow…"}
          </p>
        ) : (
          <>
            <nav
              aria-label="Workflow sections"
              className="flex shrink-0 items-center gap-5 border-b border-hairline/40 px-6"
            >
              {(
                [
                  ["flow", "Flow"],
                  ["tasks", "Tasks"],
                  ["telegram", "Telegram"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  aria-current={tab === id ? "page" : undefined}
                  className={`border-b-2 py-3 text-sm ${tab === id ? "border-accent font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink"}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                  {id === "tasks" &&
                    tasks.some(
                      (task) =>
                        task.status === "queued" || task.status === "running",
                    ) && (
                      <span className="ml-2 rounded bg-panel px-1.5 py-0.5 text-xs">
                        {
                          tasks.filter(
                            (task) =>
                              task.status === "queued" ||
                              task.status === "running",
                          ).length
                        }
                      </span>
                    )}
                </button>
              ))}
              <span className="ml-auto text-xs text-ink-secondary">
                {workflow.enabled ? "Enabled" : "Paused"}
              </span>
            </nav>
            <div
              className={`${tab === "tasks" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1`}
            >
              <WorkflowTasks
                bots={bots}
                tasks={tasks}
                enabled={workflow.enabled}
                busy={busy}
                workflowReady={
                  !dirty && Boolean(workflow.nodes.length && workflow.leadBotId)
                }
                onAdd={(task) => taskRequest("", "POST", task)}
                onRetry={(id) => void taskRequest(`/${id}/retry`, "POST")}
                onDelete={(id) => void taskRequest(`/${id}`, "DELETE")}
                onOpen={(task) => {
                  const lead =
                    runs.find((run) => run.id === task.runId)?.workflow
                      .leadBotId ?? workflow.leadBotId;
                  const owner = task.threadBotId || task.targetBotId || lead;
                  if (task.threadId && owner)
                    conversation(owner, task.threadId);
                }}
              />
            </div>
            <div
              className={`${tab === "telegram" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1`}
            >
              <WorkflowTelegramSettings
                workflow={workflow}
                bots={bots}
                status={telegram}
                dirty={dirty}
                busy={busy}
                onConnect={telegramRequest}
                onDisconnect={() => void telegramRequest()}
              />
            </div>
            <div
              className={`${tab === "flow" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col`}
            >
              <div className="flex flex-wrap items-end gap-3 border-b border-hairline/40 px-6 py-3">
                <label className="text-xs text-ink-secondary">
                  Name
                  <input
                    className={`${control} ml-2`}
                    value={workflow.name}
                    onChange={(e) =>
                      change({ ...workflow, name: e.target.value })
                    }
                  />
                </label>
                <label className="text-xs text-ink-secondary">
                  Lead bot
                  <select
                    className={`${control} ml-2`}
                    value={workflow.leadBotId}
                    onChange={(e) =>
                      change({ ...workflow, leadBotId: e.target.value })
                    }
                  >
                    <option value="">Choose a bot</option>
                    {bots.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="ml-auto flex gap-2">
                  <select
                    aria-label="Bot to add"
                    className={control}
                    value={botId}
                    onChange={(e) => setBotId(e.target.value)}
                  >
                    {bots.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className={control}
                    disabled={!botId}
                    onClick={() => {
                      const id = crypto.randomUUID();
                      change({
                        ...workflow,
                        nodes: [
                          ...workflow.nodes,
                          {
                            id,
                            botId,
                            instruction: "",
                            x: 40 + (workflow.nodes.length % 3) * 260,
                            y: 50 + Math.floor(workflow.nodes.length / 3) * 170,
                          },
                        ],
                      });
                      setSelected(id);
                      setEdgeIndex(null);
                    }}
                  >
                    <Plus size={14} className="mr-1 inline" />
                    Add step
                  </button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row">
                <section
                  aria-label="Workflow canvas"
                  className="min-h-[360px] min-w-0 flex-1 overflow-auto bg-app"
                >
                  <div
                    className="relative"
                    style={{
                      width: Math.max(
                        850,
                        ...workflow.nodes.map((n) => n.x + 250),
                      ),
                      height: Math.max(
                        480,
                        ...workflow.nodes.map((n) => n.y + 160),
                      ),
                    }}
                  >
                    {!workflow.nodes.length && (
                      <div className="p-10">
                        <h2 className="font-medium">
                          Build your team's process
                        </h2>
                        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
                          Add a bot for each step. Independent steps run in
                          parallel. Connect their outputs to choose what happens
                          next.
                        </p>
                      </div>
                    )}
                    <svg
                      className="absolute inset-0 h-full w-full"
                      aria-label="Workflow connections"
                    >
                      <defs>
                        <marker
                          id="workflow-arrow"
                          markerWidth="8"
                          markerHeight="8"
                          refX="7"
                          refY="4"
                          orient="auto"
                        >
                          <path d="M0 0 L8 4 L0 8" fill="currentColor" />
                        </marker>
                      </defs>
                      {workflow.edges.map((link, index) => {
                        const a = workflow.nodes.find(
                            (n) => n.id === link.from,
                          ),
                          b = workflow.nodes.find((n) => n.id === link.to);
                        if (!a || !b) return null;
                        const x = a.x + 220,
                          y = a.y + 60,
                          end = b.x,
                          endY = b.y + 60;
                        return (
                          <g
                            key={`${link.from}:${link.to}`}
                            className={
                              edgeIndex === index
                                ? "text-accent"
                                : "text-ink-secondary"
                            }
                          >
                            <path
                              d={`M${x} ${y} C${x + 70} ${y} ${end - 70} ${endY} ${end} ${endY}`}
                              stroke="currentColor"
                              fill="none"
                              strokeWidth={2}
                              markerEnd="url(#workflow-arrow)"
                            />
                            <foreignObject
                              x={(x + end) / 2 - 65}
                              y={(y + endY) / 2 - 14}
                              width={130}
                              height={30}
                            >
                              <button
                                className="w-full truncate rounded-md bg-panel px-2 py-1 text-xs text-ink hover:bg-control"
                                onClick={() => {
                                  setEdgeIndex(index);
                                  setSelected(null);
                                }}
                              >
                                {link.condition !== undefined
                                  ? `AI: ${link.condition}`
                                  : link.contains
                                  ? `Contains: ${link.contains}`
                                  : "Always"}
                              </button>
                            </foreignObject>
                          </g>
                        );
                      })}
                    </svg>
                    {workflow.nodes.map((node, index) => {
                      const bot = bots.find((b) => b.id === node.botId);
                      return (
                        <div
                          key={node.id}
                          data-workflow-node={node.id}
                          className={`absolute w-[220px] rounded-xl border bg-panel ${selected === node.id ? "border-accent" : "border-hairline/60"}`}
                          style={{ left: node.x, top: node.y }}
                        >
                          <button
                            className="block w-full cursor-grab touch-none px-4 pt-4 text-left active:cursor-grabbing"
                            aria-label={`Move step ${index + 1} ${bot?.name ?? node.botId}`}
                            onClick={() => {
                              if (connecting) connect(connecting, node.id);
                              setSelected(node.id);
                              setEdgeIndex(null);
                            }}
                            onPointerDown={(e) => {
                              e.currentTarget.setPointerCapture(e.pointerId);
                              drag.current = {
                                id: node.id,
                                dx: e.clientX,
                                dy: e.clientY,
                                x: node.x,
                                y: node.y,
                              };
                            }}
                            onPointerMove={(e) => {
                              const d = drag.current;
                              if (!d || d.id !== node.id) return;
                              const x = Math.max(
                                  0,
                                  Math.min(5000, d.x + e.clientX - d.dx),
                                ),
                                y = Math.max(
                                  0,
                                  Math.min(5000, d.y + e.clientY - d.dy),
                                );
                              setWorkflow((previous) => ({
                                ...previous,
                                nodes: previous.nodes.map((n) =>
                                  n.id === node.id ? { ...n, x, y } : n,
                                ),
                              }));
                              setDirty(true);
                            }}
                            onPointerUp={() => {
                              drag.current = null;
                            }}
                            onPointerCancel={() => {
                              drag.current = null;
                            }}
                          >
                            <span className="block text-sm font-medium">
                              {index + 1} · {bot?.name ?? "Unavailable bot"}
                            </span>
                            <span className="mt-1 block truncate text-xs text-ink-secondary">
                              {node.instruction || "Select to define this step"}
                            </span>
                          </button>
                          <div className="mt-4 flex items-center justify-between border-t border-hairline/40 px-3 py-2 text-xs">
                            <button
                              aria-label={`Connect into step ${index + 1} ${bot?.name}`}
                              className="rounded px-2 py-1 hover:bg-control"
                              disabled={!connecting}
                              onClick={() =>
                                connecting && connect(connecting, node.id)
                              }
                            >
                              Input
                            </button>
                            <button
                              aria-label={`Connect from step ${index + 1} ${bot?.name}`}
                              aria-pressed={connecting === node.id}
                              className="rounded px-2 py-1 text-accent-text hover:bg-control"
                              onClick={() => {
                                if (connectedByDrag.current) {
                                  connectedByDrag.current = false;
                                  return;
                                }
                                setConnecting(
                                  connecting === node.id ? null : node.id,
                                );
                              }}
                              onPointerDown={(e) => {
                                e.currentTarget.setPointerCapture(e.pointerId);
                              }}
                              onPointerUp={(e) => {
                                const hit = document
                                  .elementsFromPoint(e.clientX, e.clientY)
                                  .find(
                                    (el) =>
                                      el instanceof HTMLElement &&
                                      el.dataset.workflowNode,
                                  );
                                if (
                                  hit instanceof HTMLElement &&
                                  hit.dataset.workflowNode !== node.id
                                ) {
                                  connectedByDrag.current = true;
                                  connect(node.id, hit.dataset.workflowNode!);
                                }
                              }}
                            >
                              Output →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <aside className="w-full shrink-0 overflow-y-auto border-t border-hairline/40 bg-panel p-5 lg:w-80 lg:border-l lg:border-t-0">
                  {connecting && (
                    <p role="status" className="mb-4 text-xs text-accent-text">
                      Choose the next step's Input, or drag Output onto a step.{" "}
                      <button
                        className="underline"
                        onClick={() => setConnecting(null)}
                      >
                        Cancel
                      </button>
                    </p>
                  )}
                  {step ? (
                    <div className="space-y-4">
                      <h2 className="text-sm font-semibold">Step settings</h2>
                      <label className="block text-xs text-ink-secondary">
                        Instruction
                        <textarea
                          className={`${control} mt-2 min-h-32 w-full resize-y`}
                          value={step.instruction}
                          placeholder="What does this bot do? How should it work? What result must it return?"
                          onChange={(e) =>
                            change({
                              ...workflow,
                              nodes: workflow.nodes.map((n) =>
                                n.id === step.id
                                  ? { ...n, instruction: e.target.value }
                                  : n,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        className={`${control} disabled:opacity-50`}
                        disabled={dirty}
                        onClick={() =>
                          openBotSettings(dispatch, "identity", {
                            botId: step.botId,
                          })
                        }
                      >
                        Configure bot, CLI and skills
                      </button>
                      <p className="text-xs leading-relaxed text-ink-secondary">
                        Save workflow changes before configuring a bot. Each
                        step uses this bot's saved instructions, project
                        folders, CLI, skills and enabled MCP servers.
                      </p>
                      <div className="flex gap-2">
                        <select
                          aria-label="Next step"
                          className={`${control} min-w-0 flex-1`}
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          <option value="">Next step</option>
                          {workflow.nodes
                            .filter((n) => n.id !== step.id)
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                {bots.find((b) => b.id === n.botId)?.name} ·{" "}
                                {n.instruction.slice(0, 20)}
                              </option>
                            ))}
                        </select>
                        <button
                          className={control}
                          disabled={!target}
                          onClick={() => connect(step.id, target)}
                        >
                          Connect
                        </button>
                      </div>
                      <div className="flex gap-2">
                        {(["x", "y"] as const).map((axis) => (
                          <label
                            key={axis}
                            className="text-xs text-ink-secondary"
                          >
                            {axis.toUpperCase()}
                            <input
                              type="number"
                              min={0}
                              max={5000}
                              className={`${control} mt-1 w-full`}
                              value={step[axis]}
                              onChange={(e) =>
                                change({
                                  ...workflow,
                                  nodes: workflow.nodes.map((n) =>
                                    n.id === step.id
                                      ? {
                                          ...n,
                                          [axis]: Math.max(
                                            0,
                                            Math.min(
                                              5000,
                                              Number(e.target.value),
                                            ),
                                          ),
                                        }
                                      : n,
                                  ),
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        className={`${control} text-danger`}
                        onClick={() => {
                          change({
                            ...workflow,
                            nodes: workflow.nodes.filter(
                              (n) => n.id !== step.id,
                            ),
                            edges: workflow.edges.filter(
                              (e) => e.from !== step.id && e.to !== step.id,
                            ),
                          });
                          setSelected(null);
                        }}
                      >
                        <Trash2 size={14} className="mr-2 inline" />
                        Remove step
                      </button>
                    </div>
                  ) : edge ? (
                    <div className="space-y-4">
                      <h2 className="text-sm font-semibold">
                        Connection condition
                      </h2>
                      <label className="block space-y-2 text-xs">
                        <span>Routing rule</span>
                        <select
                          className={`${control} w-full`}
                          value={edge.condition !== undefined ? "ai" : edge.contains !== undefined ? "text" : "always"}
                          onChange={event => changeConnection({
                            from: edge.from, to: edge.to,
                            ...(event.target.value === "ai" ? { condition: edge.condition ?? edge.contains ?? "" }
                              : event.target.value === "text" ? { contains: edge.contains ?? edge.condition ?? "" } : {}),
                          })}
                        >
                          <option value="always">Always run</option>
                          <option value="ai">AI condition</option>
                          <option value="text">Exact output text</option>
                        </select>
                      </label>
                      <p className="text-xs leading-relaxed text-ink-secondary">
                        {edge.condition !== undefined
                          ? "The preceding bot evaluates your condition using the original request and its result. Its decision and reason appear in Latest run. Each check uses an extra AI turn."
                          : edge.contains !== undefined
                            ? "Only runs if the preceding result contains this exact text (case sensitive). For instructions such as ‘requests about drawing or design’, choose AI condition."
                            : "Passes each completed result to the next bot."}
                      </p>
                      {edge.condition !== undefined ? (
                        <label className="block space-y-2 text-xs">
                          <span>AI condition</span>
                          <textarea
                            className={`${control} min-h-24 w-full`}
                            maxLength={2000}
                            value={edge.condition}
                            placeholder="When the request involves drawing or UI design"
                            onChange={event => changeConnection({ from: edge.from, to: edge.to, condition: event.target.value })}
                          />
                        </label>
                      ) : edge.contains !== undefined ? (
                        <label className="block space-y-2 text-xs">
                          <span>Required text</span>
                          <input
                            className={`${control} w-full`}
                            maxLength={500}
                            value={edge.contains}
                            onChange={event => changeConnection({ from: edge.from, to: edge.to, contains: event.target.value })}
                          />
                        </label>
                      ) : null}
                      <button
                        className={`${control} text-danger`}
                        onClick={() => {
                          change({
                            ...workflow,
                            edges: workflow.edges.filter(
                              (_, i) => i !== edgeIndex,
                            ),
                          });
                          setEdgeIndex(null);
                        }}
                      >
                        Remove connection
                      </button>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-sm font-semibold">Your process</h2>
                      <p className="mt-3 text-xs leading-relaxed text-ink-secondary">
                        Drag steps to arrange them. Select a step to edit its
                        instruction. Use Output → Input to connect steps.
                        Multiple outputs create parallel branches.
                      </p>
                      <p className="mt-3 text-xs leading-relaxed text-ink-secondary">
                        A join waits for all predecessors and receives matching
                        results. Failed predecessors stop dependent work.
                        Inactive branches are skipped. Cycles are rejected when
                        saving.
                      </p>
                    </>
                  )}
                  <div className="mt-8 border-t border-hairline/40 pt-5">
                    <h2 className="text-sm font-semibold">Team task</h2>
                    <p className="mt-2 text-xs text-ink-secondary">
                      The lead bot summarizes the final results in its own
                      conversation.
                    </p>
                    <textarea
                      aria-label="Workflow task"
                      className={`${control} mt-3 min-h-24 w-full`}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="What should your team accomplish?"
                    />
                    <button
                      className={`${control} mt-2 w-full disabled:opacity-50`}
                      disabled={
                        !workflow.enabled ||
                        dirty ||
                        busy ||
                        running ||
                        !input.trim() ||
                        !workflow.nodes.length ||
                        !workflow.leadBotId
                      }
                      onClick={() => void run()}
                    >
                      <Play size={14} className="mr-2 inline" />
                      {running
                        ? "Workflow running…"
                        : !workflow.enabled
                          ? "Enable workflow to run"
                          : dirty
                            ? "Save before running"
                            : "Run workflow"}
                    </button>
                  </div>
                  {latest && (
                    <div className="mt-6 space-y-3">
                      <h2 className="text-sm font-semibold">
                        Latest run · {latest.status}
                      </h2>
                      {latest.error && (
                        <p className="text-xs text-danger">{latest.error}</p>
                      )}
                      {latest.workflow.nodes.map((n, index) => {
                        const result = latest.steps[n.id];
                        return (
                          <div key={n.id} className="text-xs">
                            <span>
                              {index + 1} ·{" "}
                              {bots.find((b) => b.id === n.botId)?.name} ·{" "}
                              {result?.status ?? "pending"}
                            </span>
                            {result?.threadId && (
                              <button
                                className="ml-2 text-accent-text underline"
                                onClick={() =>
                                  conversation(n.botId, result.threadId!)
                                }
                              >
                                Open
                              </button>
                            )}
                            {result?.status === "failed" && (
                              <p className="mt-1 text-danger">{result.error}</p>
                            )}
                            {result?.status === "skipped" && (
                              <p className="mt-1 text-ink-secondary">
                                {result.reason || "An upstream step failed or no connection condition matched. Check the connection rules."}
                              </p>
                            )}
                          </div>
                        );
                      })}
                      {latest.routing?.map(decision => {
                        const source = latest.workflow.nodes.find(n => n.id === decision.from);
                        const destination = latest.workflow.nodes.find(n => n.id === decision.to);
                        return (
                          <div key={`${decision.from}:${decision.to}`} className="space-y-1 border-t border-hairline/60 pt-3 text-xs">
                            <p className="font-medium">
                              {bots.find(b => b.id === source?.botId)?.name} → {bots.find(b => b.id === destination?.botId)?.name}
                            </p>
                            <p className="text-ink-secondary">{decision.condition}</p>
                            <p>{decision.status === "completed" ? decision.matched ? "Condition matched" : "Condition not matched" : decision.status === "running" ? "Checking condition…" : "Condition check failed"}</p>
                            <p className={decision.error ? "text-danger" : "text-ink-secondary"}>{decision.error || decision.reason}</p>
                            {source && decision.threadId && (
                              <button className="text-accent-text underline" onClick={() => conversation(source.botId, decision.threadId!)}>Open condition check</button>
                            )}
                          </div>
                        );
                      })}
                      {latest.summaryThreadId && (
                        <button
                          className={control}
                          onClick={() =>
                            conversation(
                              latest.workflow.leadBotId,
                              latest.summaryThreadId!,
                            )
                          }
                        >
                          Open lead's summary
                        </button>
                      )}
                      {latest.summary && (
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-secondary">
                          {latest.summary}
                        </p>
                      )}
                      <details>
                        <summary className="cursor-pointer text-xs text-ink-secondary">
                          Run history ({runs.length})
                        </summary>
                        {runs.map((run) => (
                          <p
                            key={run.id}
                            className="mt-2 text-xs text-ink-secondary"
                          >
                            {new Date(run.startedAt).toLocaleString()} ·{" "}
                            {run.status}
                          </p>
                        ))}
                      </details>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
