/** A step's structured result: the JSON object a verdict step ends with, or its `VERDICT:` line. */
export type ProcessVerdict = { verdict?: string; score?: number; notes?: string; items?: string[] };

/**
 * A connection runs when its condition holds: none (always), an exact output substring (`contains`), a `when`
 * expression over the source's verdict, an AI-evaluated `condition`, or `otherwise` (no sibling connection matched).
 * A `loop` connection points back to the source or one of its ancestors and re-runs that stretch at most `max` times;
 * while it fires, the source's other connections wait for the next attempt.
 */
export type ProcessEdge = {
  from: string;
  to: string;
  contains?: string;
  when?: string;
  condition?: string;
  otherwise?: boolean;
  loop?: { max: number };
};
/** `join` decides how incoming connections combine: any (default), all, or at least this many. `forEach` runs the step
 * once per item its inputs' verdicts list, at most `concurrency` at a time. */
export type ProcessGraphStep = { id: string; forEach?: boolean; concurrency?: number; join?: "any" | "all" | number };
export type ProcessGraph = { steps: ProcessGraphStep[]; edges: ProcessEdge[] };

export type ProcessStepResult =
  | { status: "completed"; text: string; verdict?: ProcessVerdict; attempts: number }
  | { status: "failed"; error: string; attempts: number }
  | { status: "skipped"; reason: string; attempts: number };

export type ProcessStepContext = {
  inputs: { stepId: string; text: string }[];
  /** The output that sent a loop back to this step, for the next attempt to fix. */
  feedback?: { stepId: string; text: string };
  item?: { index: number; total: number; value: string };
  attempt: number;
};

export const PROCESS_LOOP_MAX = 10;
const STEP_RUNS_MAX = 400;

type Comparison = { field: "verdict" | "score" | "status"; op: "==" | "!=" | ">=" | "<=" | ">" | "<"; value: string | number };
/** Disjunction of conjunctions: `a and b or c` is `(a and b) or c`. */
export type ProcessCondition = Comparison[][];

export function parseProcessCondition(source: string): ProcessCondition {
  const tokens = source.match(/"[^"]*"|'[^']*'|>=|<=|==|!=|>|<|[^\s<>=!"']+/g) ?? [];
  const groups: Comparison[][] = [[]];
  for (let i = 0; i < tokens.length; ) {
    const [field, op, raw] = [tokens[i]!.toLowerCase(), tokens[i + 1], tokens[i + 2]];
    if (field !== "verdict" && field !== "score" && field !== "status") throw new Error(`Unknown field "${tokens[i]}": use verdict, score or status`);
    if (op !== "==" && op !== "!=" && op !== ">=" && op !== "<=" && op !== ">" && op !== "<") throw new Error(`Expected a comparison after ${field}`);
    if (raw === undefined) throw new Error(`Expected a value after ${field} ${op}`);
    const text = /^["'].*["']$/.test(raw) ? raw.slice(1, -1) : raw;
    const value = field === "score" ? Number(text) : text;
    if (field === "score" && !Number.isFinite(value)) throw new Error("score compares with a number");
    if (field !== "score" && op !== "==" && op !== "!=") throw new Error(`${field} compares with == or !=`);
    groups.at(-1)!.push({ field, op, value });
    i += 3;
    if (i >= tokens.length) break;
    const joiner = tokens[i]!.toLowerCase();
    if (joiner === "or") groups.push([]);
    else if (joiner !== "and") throw new Error(`Expected "and" or "or", found "${tokens[i]}"`);
    i++;
    if (i >= tokens.length) throw new Error("Condition ends with and/or");
  }
  if (!groups[0]!.length) throw new Error("Condition must not be empty");
  return groups;
}

export function matchesProcessCondition(condition: ProcessCondition, facts: { verdict?: string; score?: number; status: string }): boolean {
  return condition.some(group => group.every(({ field, op, value }) => {
    if (field === "score") {
      const score = facts.score;
      if (score === undefined) return false;
      const target = value as number;
      return op === "==" ? score === target : op === "!=" ? score !== target : op === ">=" ? score >= target
        : op === "<=" ? score <= target : op === ">" ? score > target : score < target;
    }
    const actual = (field === "verdict" ? facts.verdict : facts.status)?.toUpperCase();
    if (actual === undefined) return false;
    const equal = actual !== undefined && actual === String(value).toUpperCase();
    return op === "==" ? equal : !equal;
  }));
}

function balancedObject(text: string, start: number): string | undefined {
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === "\\") i++;
      else if (char === "\"") quoted = false;
    } else if (char === "\"") quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

/** The last JSON object carrying a verdict, else a `VERDICT: X` line with an optional `score: N`. */
export function readProcessVerdict(text: string): ProcessVerdict | undefined {
  for (let at = text.lastIndexOf("{"); at >= 0; at = at ? text.lastIndexOf("{", at - 1) : -1) {
    const candidate = balancedObject(text, at);
    if (!candidate || !/"verdict"\s*:/i.test(candidate)) continue;
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      const key = Object.keys(value).find(name => name.toLowerCase() === "verdict");
      if (!key || typeof value[key] !== "string") continue;
      const score = Number(value.score);
      return {
        verdict: String(value[key]).trim().toUpperCase(),
        ...(value.score !== undefined && Number.isFinite(score) ? { score } : {}),
        ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
        ...(Array.isArray(value.items) ? { items: value.items.map(item => typeof item === "string" ? item : JSON.stringify(item)) } : {}),
      };
    } catch {}
  }
  const line = text.match(/^\W*VERDICT\W*[:=]\s*\**\s*([A-Za-z_]+)/im);
  if (!line) return undefined;
  const score = text.match(/\bscore\W*[:=]\s*(\d+(?:\.\d+)?)/i);
  return { verdict: line[1]!.toUpperCase(), ...(score ? { score: Number(score[1]) } : {}) };
}

function conditionKinds(edge: ProcessEdge): number {
  return [edge.contains !== undefined, edge.when !== undefined, edge.condition !== undefined, edge.otherwise === true].filter(Boolean).length;
}

export function validateProcessGraph(graph: ProcessGraph): void {
  const ids = new Set(graph.steps.map(step => step.id));
  if (ids.size !== graph.steps.length || ids.has("")) throw new Error("Duplicate or empty step ID");
  const pairs = new Set<string>();
  const forward = graph.edges.filter(edge => !edge.loop);
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error("Connection references an unknown step");
    const pair = JSON.stringify([edge.from, edge.to]);
    if (pairs.has(pair)) throw new Error("Duplicate connection");
    pairs.add(pair);
    if (edge.contains !== undefined && !edge.contains.trim()) throw new Error("Output text condition must not be empty");
    if (edge.condition !== undefined && !edge.condition.trim()) throw new Error("AI condition must not be empty");
    if (edge.when !== undefined) parseProcessCondition(edge.when);
    if (conditionKinds(edge) > 1) throw new Error("Choose one condition per connection");
    if (edge.loop) {
      if (!Number.isInteger(edge.loop.max) || edge.loop.max < 1 || edge.loop.max > PROCESS_LOOP_MAX)
        throw new Error(`A loop repeats 1 to ${PROCESS_LOOP_MAX} times`);
      if (!conditionKinds(edge) || edge.otherwise) throw new Error("A loop needs a condition saying when to repeat");
    }
  }
  if (graph.edges.filter(edge => edge.otherwise).some((edge, index, all) => all.findIndex(other => other.from === edge.from) !== index))
    throw new Error("A step has at most one otherwise connection");
  const indegree = new Map(graph.steps.map(step => [step.id, 0]));
  for (const edge of forward) indegree.set(edge.to, indegree.get(edge.to)! + 1);
  const ready = graph.steps.filter(step => indegree.get(step.id) === 0).map(step => step.id);
  const remaining = new Map(indegree);
  for (let i = 0; i < ready.length; i++) {
    for (const edge of forward.filter(entry => entry.from === ready[i])) {
      remaining.set(edge.to, remaining.get(edge.to)! - 1);
      if (remaining.get(edge.to) === 0) ready.push(edge.to);
    }
  }
  if (ready.length !== ids.size) throw new Error("Connections form a cycle: mark the connection that goes back as a loop");
  for (const edge of graph.edges.filter(entry => entry.loop)) {
    if (edge.to !== edge.from && !ancestors(forward, edge.from).has(edge.to))
      throw new Error("A loop must go back to its own step or an earlier step on the same path");
    const region = loopRegion(forward, edge);
    if (forward.some(connection => region.has(connection.from) && connection.from !== edge.from && !region.has(connection.to)))
      throw new Error("Join parallel branches before looping back to their shared input");
  }
  for (const step of graph.steps) {
    const incoming = indegree.get(step.id)!;
    if (step.forEach && !incoming) throw new Error("A step that runs per item needs an incoming connection");
    if (step.concurrency !== undefined && (!Number.isInteger(step.concurrency) || step.concurrency < 1 || step.concurrency > 8))
      throw new Error("Run 1 to 8 items at a time");
    if (typeof step.join === "number" && (!Number.isInteger(step.join) || step.join < 1 || step.join > Math.max(1, incoming)))
      throw new Error("A quorum needs between 1 and the step's incoming connections");
  }
}

function ancestors(forward: ProcessEdge[], id: string): Set<string> {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.pop()!;
    for (const edge of forward) if (edge.to === current && !found.has(edge.from)) { found.add(edge.from); queue.push(edge.from); }
  }
  return found;
}

function descendants(forward: ProcessEdge[], id: string): Set<string> {
  const found = new Set<string>([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.pop()!;
    for (const edge of forward) if (edge.from === current && !found.has(edge.to)) { found.add(edge.to); queue.push(edge.to); }
  }
  return found;
}

function loopRegion(forward: ProcessEdge[], edge: ProcessEdge): Set<string> {
  const upstream = ancestors(forward, edge.from);
  return new Set([...descendants(forward, edge.to)].filter(id => id === edge.from || upstream.has(id)));
}

async function mapLimited<T, R>(values: T[], limit: number, each: (value: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await each(values[index]!, index) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

export async function executeProcess(
  graph: ProcessGraph,
  run: (stepId: string, context: ProcessStepContext) => Promise<string>,
  options: {
    evaluate?: (edge: ProcessEdge, text: string) => Promise<boolean>;
    signal?: AbortSignal;
    onStart?: (stepId: string, attempt: number) => void;
    onSettle?: (stepId: string, result: ProcessStepResult) => void;
  } = {},
): Promise<Record<string, ProcessStepResult>> {
  validateProcessGraph(graph);
  const forward = graph.edges.filter(edge => !edge.loop);
  const loops = graph.edges.filter(edge => edge.loop);
  const loopCounts = new Map<ProcessEdge, number>();
  const results = new Map<string, ProcessStepResult>();
  const attempts = new Map<string, number>();
  const feedback = new Map<string, { stepId: string; text: string }>();
  const matches = new Map<ProcessEdge, Promise<boolean>>();
  const running = new Map<string, Promise<void>>();
  let stepRuns = 0;

  const facts = (result: ProcessStepResult) => result.status === "completed"
    ? { status: "completed", verdict: result.verdict?.verdict, score: result.verdict?.score }
    : { status: result.status };
  async function evaluateEdge(edge: ProcessEdge): Promise<boolean> {
    const source = results.get(edge.from);
    if (!source || source.status === "skipped") return false;
    if (edge.when !== undefined) return matchesProcessCondition(parseProcessCondition(edge.when), facts(source));
    if (source.status !== "completed") return false;
    if (edge.contains !== undefined) return source.text.includes(edge.contains);
    if (edge.condition !== undefined) {
      if (!options.evaluate) throw new Error("AI condition evaluator is unavailable");
      return options.evaluate(edge, source.text);
    }
    if (edge.otherwise) {
      const siblings = forward.filter(other => other.from === edge.from && other !== edge);
      for (const sibling of siblings) if (await match(sibling)) return false;
      return true;
    }
    return true;
  }
  function match(edge: ProcessEdge): Promise<boolean> {
    let cached = matches.get(edge);
    if (!cached) { cached = evaluateEdge(edge); matches.set(edge, cached); }
    return cached;
  }
  function settle(stepId: string, result: ProcessStepResult) {
    results.set(stepId, result);
    for (const edge of graph.edges) if (edge.from === stepId) matches.delete(edge);
    options.onSettle?.(stepId, result);
  }

  async function decide(step: ProcessGraphStep): Promise<{ run: false; reason: string } | { run: true; inputs: ProcessStepContext["inputs"] }> {
    const incoming = forward.filter(edge => edge.to === step.id);
    if (!incoming.length) return { run: true, inputs: [] };
    const matched: ProcessEdge[] = [];
    for (const edge of incoming) if (await match(edge)) matched.push(edge);
    const join = step.join ?? "any";
    if (join === "any" && incoming.some(edge => results.get(edge.from)?.status === "failed" && !matched.includes(edge)))
      return { run: false, reason: "An earlier step failed." };
    const needed = join === "all" ? incoming.length : join === "any" ? 1 : join;
    if (matched.length < needed)
      return { run: false, reason: join === "any" ? "No incoming condition matched." : `${matched.length} of ${incoming.length} incoming conditions matched; ${needed} needed.` };
    return { run: true, inputs: matched.flatMap(edge => {
      const source = results.get(edge.from)!;
      return [{ stepId: edge.from, text: source.status === "completed" ? source.text : source.status === "failed" ? `Failed: ${source.error}` : "" }];
    }) };
  }

  async function execute(step: ProcessGraphStep, inputs: ProcessStepContext["inputs"]): Promise<ProcessStepResult> {
    const attempt = (attempts.get(step.id) ?? 0) + 1;
    attempts.set(step.id, attempt);
    const context = { inputs, attempt, ...(feedback.has(step.id) ? { feedback: feedback.get(step.id)! } : {}) };
    options.onStart?.(step.id, attempt);
    try {
      if (!step.forEach) {
        if (++stepRuns > STEP_RUNS_MAX) throw new Error("The process ran too many steps; check its loops");
        const text = await run(step.id, context);
        const verdict = readProcessVerdict(text);
        return { status: "completed", text, attempts: attempt, ...(verdict ? { verdict } : {}) };
      }
      const items = inputs.flatMap(input => readProcessVerdict(input.text)?.items ?? []);
      if (!items.length) return { status: "skipped", reason: "No items to run: the incoming step listed none in its verdict.", attempts: attempt };
      stepRuns += items.length;
      if (stepRuns > STEP_RUNS_MAX) throw new Error("The process ran too many steps; check its loops");
      const outcomes = await mapLimited(items, step.concurrency ?? 3, (value, index) => {
        options.signal?.throwIfAborted();
        return run(step.id, { ...context, item: { index, total: items.length, value } });
      });
      const failed = outcomes.flatMap((outcome, index) => outcome.status === "rejected"
        ? [`${items[index]}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`] : []);
      if (failed.length) return { status: "failed", error: `${failed.length} of ${items.length} items failed: ${failed.join("; ")}`, attempts: attempt };
      const texts = outcomes.map(outcome => (outcome as PromiseFulfilledResult<string>).value);
      const verdicts = texts.map(readProcessVerdict);
      const text = texts.map((entry, index) => `### ${index + 1}/${items.length}: ${items[index]}\n${entry}`).join("\n\n");
      if (verdicts.some(verdict => !verdict?.verdict)) return { status: "completed", text, attempts: attempt };
      const passing = (verdict: ProcessVerdict | undefined) => verdict!.verdict === "PASS";
      const scores = verdicts.flatMap(verdict => verdict!.score === undefined ? [] : [verdict!.score]);
      const aggregate: ProcessVerdict = {
        verdict: verdicts.every(passing) ? "PASS" : "FAIL",
        ...(scores.length ? { score: Math.min(...scores) } : {}),
        items: items.filter((_, index) => !passing(verdicts[index])),
      };
      return { status: "completed", text: `${text}\n\n${JSON.stringify(aggregate)}`, attempts: attempt, verdict: aggregate };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error), attempts: attempt };
    }
  }

  async function afterSettle(stepId: string) {
    const result = results.get(stepId)!;
    for (const edge of loops.filter(entry => entry.from === stepId)) {
      const count = loopCounts.get(edge) ?? 0;
      if (!await match(edge)) continue;
      if (count >= edge.loop!.max) {
        const exits = forward.filter(connection => connection.from === stepId && conditionKinds(connection));
        if ((await Promise.all(exits.map(match))).some(Boolean)) continue;
        const error = `Feedback loop from ${edge.from} to ${edge.to} exhausted after ${count} repeats; add a conditional escalation`;
        settle(stepId, { status: "failed", error, attempts: attempts.get(stepId) ?? 0 });
        throw new Error(error);
      }
      loopCounts.set(edge, count + 1);
      const region = loopRegion(forward, edge);
      feedback.set(edge.to, { stepId, text: result.status === "completed" ? result.text : result.status === "failed" ? `Failed: ${result.error}` : "" });
      for (const id of region) {
        results.delete(id);
        for (const other of graph.edges) if (other.from === id) matches.delete(other);
      }
      return;
    }
  }

  while (true) {
    options.signal?.throwIfAborted();
    for (const step of graph.steps) {
      if (results.has(step.id) || running.has(step.id)) continue;
      const predecessors = forward.filter(edge => edge.to === step.id).map(edge => edge.from);
      if (!predecessors.every(id => results.has(id) && !running.has(id))) continue;
      const task = (async () => {
        const decision = await decide(step);
        const result = decision.run ? await execute(step, decision.inputs)
          : { status: "skipped" as const, reason: decision.reason, attempts: attempts.get(step.id) ?? 0 };
        options.signal?.throwIfAborted();
        settle(step.id, result);
        await afterSettle(step.id);
      })().finally(() => running.delete(step.id));
      task.catch(() => {});
      running.set(step.id, task);
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
  return Object.fromEntries(graph.steps.map(step => [step.id, results.get(step.id)!]));
}
