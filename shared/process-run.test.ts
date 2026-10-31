import { describe, expect, it } from "vitest";
import { executeProcess, parseProcessCondition, readProcessVerdict, validateProcessGraph, type ProcessGraph, type ProcessStepContext } from "./process-run.ts";

const steps = (...ids: string[]) => ids.map(id => ({ id }));
const verdict = (value: string, extra: Record<string, unknown> = {}) => `done\n\`\`\`json\n${JSON.stringify({ verdict: value, ...extra })}\n\`\`\``;

describe("readProcessVerdict", () => {
  it("reads the last JSON verdict object, then a VERDICT line", () => {
    expect(readProcessVerdict(`{"verdict":"FAIL"} then ${verdict("pass", { score: 91, notes: "ok", items: ["a", { b: 1 }] })}`))
      .toEqual({ verdict: "PASS", score: 91, notes: "ok", items: ["a", "{\"b\":1}"] });
    expect(readProcessVerdict("Tổng điểm\nscore: 88\n**VERDICT: needs_decision**")).toEqual({ verdict: "NEEDS_DECISION", score: 88 });
    expect(readProcessVerdict("{\"note\": \"a } brace\"} no verdict")).toBeUndefined();
  });
});

describe("process conditions", () => {
  it("parses and/or over verdict, score and status", () => {
    expect(parseProcessCondition('verdict == "FAIL" and score < 90 or status == failed')).toHaveLength(2);
    expect(() => parseProcessCondition("mood == happy")).toThrow("Unknown field");
    expect(() => parseProcessCondition("score >= high")).toThrow("number");
    expect(() => parseProcessCondition("verdict > PASS")).toThrow("== or !=");
    expect(() => parseProcessCondition("verdict == PASS and")).toThrow("ends with");
  });

  it("validates loops, otherwise and quorum", () => {
    const graph = (edges: ProcessGraph["edges"], extra: Partial<ProcessGraph["steps"][number]> = {}): ProcessGraph =>
      ({ steps: [{ id: "a" }, { id: "b", ...extra }, { id: "c" }], edges });
    expect(() => validateProcessGraph(graph([{ from: "a", to: "b" }, { from: "b", to: "a" }]))).toThrow("mark the connection that goes back as a loop");
    expect(() => validateProcessGraph(graph([{ from: "a", to: "b" }, { from: "b", to: "a", loop: { max: 2 } }]))).toThrow("needs a condition");
    expect(() => validateProcessGraph(graph([{ from: "a", to: "b" }, { from: "c", to: "a", when: "verdict == FAIL", loop: { max: 2 } }]))).toThrow("earlier step on the same path");
    expect(() => validateProcessGraph(graph([{ from: "a", to: "b" }, { from: "b", to: "a", when: "verdict == FAIL", loop: { max: 11 } }]))).toThrow("1 to 10");
    expect(() => validateProcessGraph(graph([{ from: "a", to: "b", otherwise: true }, { from: "a", to: "c", otherwise: true }]))).toThrow("at most one otherwise");
    expect(() => validateProcessGraph(graph([{ from: "a", to: "b", when: "verdict == PASS", contains: "x" }]))).toThrow("one condition");
    expect(() => validateProcessGraph(graph([{ from: "a", to: "b" }], { join: 2 }))).toThrow("quorum");
    expect(() => validateProcessGraph(graph([], { forEach: true }))).toThrow("incoming connection");
    validateProcessGraph(graph([{ from: "a", to: "b" }, { from: "b", to: "a", when: "verdict == FAIL", loop: { max: 3 } }]));
  });
});

describe("executeProcess", () => {
  it("requires parallel branches to join before feedback repeats their shared input", () => {
    expect(() => validateProcessGraph({ steps: steps("build", "visual", "code", "ship"), edges: [
      { from: "build", to: "visual" }, { from: "build", to: "code" },
      { from: "visual", to: "build", when: "verdict == FAIL", loop: { max: 2 } },
      { from: "visual", to: "ship" }, { from: "code", to: "ship" },
    ] })).toThrow("Join parallel branches before looping");
  });

  it("fails an exhausted feedback loop unless a conditional escalation handles it", async () => {
    const seen: string[] = [];
    await expect(executeProcess({ steps: steps("work", "deliver"), edges: [
      { from: "work", to: "work", when: "verdict == FAIL", loop: { max: 1 } },
      { from: "work", to: "deliver" },
    ] }, async id => { seen.push(id); return verdict("FAIL"); })).rejects.toThrow("exhausted");
    expect(seen).toEqual(["work", "work"]);
  });

  it("stops starting fan-out items after cancellation", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    await expect(executeProcess({ steps: [{ id: "list" }, { id: "item", forEach: true, concurrency: 1 }], edges: [
      { from: "list", to: "item" },
    ] }, async (id, context) => {
      if (id === "list") return verdict("PASS", { items: ["a", "b", "c"] });
      seen.push(context.item!.value); controller.abort(); return verdict("PASS");
    }, { signal: controller.signal })).rejects.toThrow();
    expect(seen).toEqual(["a"]);
  });

  it("does not treat a missing verdict as a passing negative comparison", async () => {
    const results = await executeProcess({ steps: steps("review", "deliver"), edges: [
      { from: "review", to: "deliver", when: "verdict != FAIL" },
    ] }, async () => "malformed review");
    expect(results.deliver.status).toBe("skipped");
  });

  it("runs independent branches in parallel and joins after both", async () => {
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    const results = await executeProcess({ steps: steps("a", "b", "join"), edges: [{ from: "a", to: "join" }, { from: "b", to: "join" }] }, async (id, context) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active--; order.push(id);
      return id === "join" ? context.inputs.map(input => input.stepId).sort().join("+") : id;
    }, { onStart: () => {} });
    expect(peak).toBe(2);
    expect(order.at(-1)).toBe("join");
    expect(results.join).toMatchObject({ status: "completed", text: "a+b" });
  });

  it("branches on verdicts with an otherwise fallback", async () => {
    const graph: ProcessGraph = { steps: steps("check", "ship", "fix", "ask"), edges: [
      { from: "check", to: "ship", when: "verdict == PASS and score >= 90" },
      { from: "check", to: "fix", when: "verdict == FAIL" },
      { from: "check", to: "ask", otherwise: true },
    ] };
    const ran = async (output: string) => {
      const seen: string[] = [];
      await executeProcess(graph, async id => { seen.push(id); return id === "check" ? output : id; });
      return seen;
    };
    expect(await ran(verdict("PASS", { score: 95 }))).toEqual(["check", "ship"]);
    expect(await ran(verdict("PASS", { score: 70 }))).toEqual(["check", "ask"]);
    expect(await ran(verdict("FAIL"))).toEqual(["check", "fix"]);
    expect(await ran("no verdict at all")).toEqual(["check", "ask"]);
  });

  it("loops back with feedback until the check passes", async () => {
    const contexts: ProcessStepContext[] = [];
    let reviews = 0;
    const results = await executeProcess({ steps: steps("plan", "build", "review", "deliver"), edges: [
      { from: "plan", to: "build" },
      { from: "build", to: "review" },
      { from: "review", to: "deliver", when: "verdict == PASS" },
      { from: "review", to: "build", when: "verdict == FAIL", loop: { max: 3 } },
    ] }, async (id, context) => {
      if (id === "build") contexts.push(context);
      if (id === "review") return ++reviews < 3 ? verdict("FAIL", { notes: `fix ${reviews}` }) : verdict("PASS");
      return id;
    });
    expect(contexts.map(context => [context.attempt, context.feedback?.text.includes("fix") ?? false])).toEqual([[1, false], [2, true], [3, true]]);
    expect(contexts[2]!.feedback!.text).toContain("fix 2");
    expect(contexts[2]!.inputs).toEqual([{ stepId: "plan", text: "plan" }]);
    expect(results.deliver).toMatchObject({ status: "completed" });
    expect(results.review).toMatchObject({ status: "completed", attempts: 3 });
  });

  it("escalates after a loop runs out", async () => {
    const seen: string[] = [];
    const results = await executeProcess({ steps: steps("work", "escalate", "deliver"), edges: [
      { from: "work", to: "work", when: "verdict == FAIL", loop: { max: 2 } },
      { from: "work", to: "escalate", when: "verdict == FAIL" },
      { from: "work", to: "deliver", when: "verdict == PASS" },
    ] }, async id => { seen.push(id); return id === "work" ? verdict("FAIL") : id; });
    expect(seen).toEqual(["work", "work", "work", "escalate"]);
    expect(results.deliver).toMatchObject({ status: "skipped" });
  });

  it("retries a failed step with a status loop, and routes failures", async () => {
    let calls = 0;
    const results = await executeProcess({ steps: steps("flaky", "next", "report"), edges: [
      { from: "flaky", to: "flaky", when: "status == failed", loop: { max: 2 } },
      { from: "flaky", to: "next" },
      { from: "flaky", to: "report", when: "status == failed" },
    ] }, async id => {
      if (id === "flaky" && ++calls < 3) throw new Error(`boom ${calls}`);
      return id;
    });
    expect(results.flaky).toMatchObject({ status: "completed", attempts: 3 });
    expect(results.next).toMatchObject({ status: "completed" });
    expect(results.report).toMatchObject({ status: "skipped" });
    const failing = await executeProcess({ steps: steps("bad", "next", "report"), edges: [
      { from: "bad", to: "next" }, { from: "bad", to: "report", when: "status == failed" },
    ] }, async id => { if (id === "bad") throw new Error("nope"); return id; });
    expect(failing.next).toMatchObject({ status: "skipped", reason: "An earlier step failed." });
    expect(failing.report).toMatchObject({ status: "completed" });
  });

  it("joins by all and by quorum", async () => {
    const graph = (join: "all" | number): ProcessGraph => ({ steps: [...steps("r1", "r2", "r3"), { id: "merge", join }], edges: [
      { from: "r1", to: "merge", when: "verdict == PASS" }, { from: "r2", to: "merge", when: "verdict == PASS" }, { from: "r3", to: "merge", when: "verdict == PASS" },
    ] });
    const review = async (id: string) => id === "r3" ? verdict("FAIL") : id === "merge" ? "merged" : verdict("PASS");
    expect((await executeProcess(graph(2), review)).merge).toMatchObject({ status: "completed" });
    expect((await executeProcess(graph("all"), review)).merge).toMatchObject({ status: "skipped", reason: "2 of 3 incoming conditions matched; 3 needed." });
  });

  it("fans out per listed item with a concurrency cap and aggregates verdicts", async () => {
    let active = 0;
    let peak = 0;
    const items: string[] = [];
    const results = await executeProcess({ steps: [{ id: "list" }, { id: "screen", forEach: true, concurrency: 2 }, { id: "fix" }], edges: [
      { from: "list", to: "screen" },
      { from: "screen", to: "fix", when: "verdict == FAIL" },
    ] }, async (id, context) => {
      if (id === "list") return verdict("PASS", { items: ["home", "shop", "farm", "map"] });
      if (id === "fix") return `fix ${readProcessVerdict(context.inputs[0]!.text)?.items?.join(",") ?? ""}`;
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active--;
      items.push(`${context.item!.index + 1}/${context.item!.total} ${context.item!.value}`);
      return verdict(context.item!.value === "shop" ? "FAIL" : "PASS", { score: context.item!.value === "shop" ? 60 : 95 });
    });
    expect(peak).toBe(2);
    expect(items.sort()).toEqual(["1/4 home", "2/4 shop", "3/4 farm", "4/4 map"]);
    expect(results.screen).toMatchObject({ status: "completed", verdict: { verdict: "FAIL", score: 60, items: ["shop"] } });
    expect(results.fix).toMatchObject({ status: "completed", text: "fix shop" });
  });

  it("stops scheduling when aborted", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    await expect(executeProcess({ steps: steps("a", "b"), edges: [{ from: "a", to: "b" }] }, async id => {
      seen.push(id); controller.abort(); return id;
    }, { signal: controller.signal })).rejects.toThrow();
    expect(seen).toEqual(["a"]);
  });
});
