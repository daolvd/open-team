/** `when` is the person's description of the requests a step takes; only a step without incoming connections has one. */
export type WorkflowNode = { id: string; botId: string; instruction: string; when?: string };
/** A connection is unconditional, an exact output substring, or an AI-evaluated instruction. */
export type WorkflowEdge = { from: string; to: string; contains?: string; condition?: string };
export type Workflow = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
export type WorkflowResult =
  | { status: "completed"; result: string }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason?: string };

export function validateWorkflow(workflow: Workflow): void {
  const nodes = new Set(workflow.nodes.map((node) => node.id));
  if (nodes.size !== workflow.nodes.length || nodes.has(""))
    throw new Error("Duplicate or empty node ID");
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const edges = new Set<string>();
  for (const edge of workflow.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      throw new Error("Edge references unknown node");
    if (edge.contains !== undefined && !edge.contains.trim())
      throw new Error("Edge condition must not be empty");
    if (edge.condition !== undefined && !edge.condition.trim())
      throw new Error("AI condition must not be empty");
    if (edge.contains !== undefined && edge.condition !== undefined)
      throw new Error("Choose one connection condition type");
    const key = JSON.stringify([edge.from, edge.to]);
    if (edges.has(key)) throw new Error("Duplicate edge");
    edges.add(key);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    indegree.set(edge.to, indegree.get(edge.to)! + 1);
  }
  for (const node of workflow.nodes) {
    if (node.when === undefined) continue;
    if (!node.when.trim()) throw new Error("Request rule must not be empty");
    if (indegree.get(node.id)) throw new Error("Only a step without incoming connections can take requests by rule");
  }
  const ready = workflow.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  for (let i = 0; i < ready.length; i++) {
    for (const next of outgoing.get(ready[i]!) ?? []) {
      const count = indegree.get(next)! - 1;
      indegree.set(next, count);
      if (count === 0) ready.push(next);
    }
  }
  if (ready.length !== nodes.size) throw new Error("Workflow contains a cycle");
}

export async function executeWorkflow(
  workflow: Workflow,
  run: (
    node: WorkflowNode,
    inputs: { nodeId: string; result: string }[],
  ) => Promise<string>,
  evaluate?: (edge: WorkflowEdge, output: string) => Promise<boolean>,
  unselected: ReadonlyMap<string, string> = new Map(),
): Promise<Record<string, WorkflowResult>> {
  validateWorkflow(workflow);
  const tasks = new Map<string, Promise<WorkflowResult>>();
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  function execute(node: WorkflowNode): Promise<WorkflowResult> {
    const existing = tasks.get(node.id);
    if (existing) return existing;
    const reason = unselected.get(node.id);
    if (reason !== undefined) {
      const skipped = Promise.resolve<WorkflowResult>({ status: "skipped", reason });
      tasks.set(node.id, skipped);
      return skipped;
    }
    const predecessors = workflow.edges.filter((edge) => edge.to === node.id);
    const task = Promise.all(
      predecessors.map((edge) => execute(nodes.get(edge.from)!)),
    ).then(async (results): Promise<WorkflowResult> => {
      if (results.some((result) => result.status === "failed"))
        return { status: "skipped" };
      try {
        const inputs: { nodeId: string; result: string }[] = [];
        for (const [index, result] of results.entries()) {
          if (result.status !== "completed") continue;
          const edge = predecessors[index]!;
          if (edge.contains !== undefined && !result.result.includes(edge.contains)) continue;
          if (edge.condition !== undefined) {
            if (!evaluate) throw new Error("AI condition evaluator is unavailable");
            if (!await evaluate(edge, result.result)) continue;
          }
          inputs.push({ nodeId: edge.from, result: result.result });
        }
        if (predecessors.length && !inputs.length) return {
          status: "skipped",
          reason: "No incoming condition matched a completed step. Check the connection conditions.",
        };
        return { status: "completed", result: await run(node, inputs) };
      } catch (error) {
        return {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
    tasks.set(node.id, task);
    return task;
  }
  const results = await Promise.all(workflow.nodes.map(execute));
  return Object.fromEntries(
    workflow.nodes.map((node, index) => [node.id, results[index]!]),
  );
}

export type WorkflowDocument = Omit<Workflow, "nodes"> & {
  name: string;
  enabled: boolean;
  leadBotId: string;
  nodes: (WorkflowNode & { x: number; y: number })[];
};
export type WorkflowRun = {
  id: string;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt: number;
  finishedAt?: number;
  input: string;
  workflow: WorkflowDocument;
  steps: Record<
    string,
    (WorkflowResult | { status: "running" }) & { threadId?: string }
  >;
  routing?: {
    from: string;
    to: string;
    condition: string;
    status: "running" | "completed" | "failed";
    threadId?: string;
    matched?: boolean;
    reason?: string;
    error?: string;
  }[];
  /** The lead's choice of steps by their `when` rules; an empty `selected` means the lead handled the request itself. */
  selection?: {
    status: "running" | "completed" | "failed";
    threadId?: string;
    selected?: string[];
    reason?: string;
    error?: string;
  };
  summary?: string;
  summaryThreadId?: string;
  error?: string;
};

export function workflowFromEntry<T extends Workflow>(
  workflow: T,
  entryId: string,
): T {
  if (!workflow.nodes.some((node) => node.id === entryId))
    throw new Error("Choose an available input step.");
  const reachable = new Set([entryId]);
  const pending = [entryId];
  for (let i = 0; i < pending.length; i++) {
    for (const edge of workflow.edges.filter(
      (edge) => edge.from === pending[i],
    )) {
      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        pending.push(edge.to);
      }
    }
  }
  return {
    ...workflow,
    nodes: workflow.nodes.filter((node) => reachable.has(node.id)),
    edges: workflow.edges.filter(
      (edge) => reachable.has(edge.from) && reachable.has(edge.to),
    ),
  };
}

export type WorkflowTask = {
  id: string;
  title: string;
  input: string;
  targetBotId?: string;
  entryNodeId?: string;
  priority: "high" | "normal" | "low";
  source: "ui" | "telegram" | "bot";
  createdByBotId?: string;
  parentTaskId?: string;
  delegationDepth?: number;
  conversationKey?: string;
  /** A failed/interrupted task awaiting its authorized Chief's reconciliation. */
  recoveryPending?: boolean;
  /** Persisted linkage prevents duplicate reconciliation after restart. */
  recoveryTaskId?: string;
  /** The original task to inspect, without replaying its side effects. */
  recoveryForTaskId?: string;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  runId?: string;
  threadId?: string;
  threadBotId?: string;
  result?: string;
  error?: string;
};

export type WorkflowTelegramStatus = {
  connected: boolean;
  state: "disconnected" | "paused" | "connecting" | "listening" | "error";
  username?: string;
  chatId?: string;
  userId?: string;
  entryNodeId?: string;
  targetBotId?: string;
  error?: string;
};
