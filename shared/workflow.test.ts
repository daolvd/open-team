import { describe, expect, it } from "vitest";
import { executeWorkflow, validateWorkflow, type Workflow } from "./workflow";

const workflow: Workflow = {
  nodes: [
    { id: "a", botId: "bot-a", instruction: "Analyze" },
    { id: "b", botId: "bot-b", instruction: "Research" },
    { id: "c", botId: "bot-c", instruction: "Implement" },
  ],
  edges: [
    { from: "a", to: "c" },
    { from: "b", to: "c" },
  ],
};

describe("workflow execution", () => {
  it("runs independent bots together and passes both results to their successor", async () => {
    const started: string[] = [];
    const release: Record<string, (value: string) => void> = {};
    const run = executeWorkflow(workflow, async (node, inputs) => {
      started.push(node.id);
      if (node.id === "c") return inputs.map((input) => input.result).join("+");
      return new Promise<string>((resolve) => {
        release[node.id] = resolve;
      });
    });
    await Promise.resolve();
    expect(started).toEqual(["a", "b"]);
    release.a!("analysis");
    release.b!("research");
    const result = await run;
    expect(started).toEqual(["a", "b", "c"]);
    expect(result.c).toEqual({
      status: "completed",
      result: "analysis+research",
    });
  });

  it("skips dependent work when a bot fails and preserves independent results", async () => {
    const result = await executeWorkflow(workflow, async (node) => {
      if (node.id === "a") throw new Error("failed");
      return "ok";
    });
    expect(result.a).toEqual({ status: "failed", error: "failed" });
    expect(result.b).toEqual({ status: "completed", result: "ok" });
    expect(result.c).toEqual({ status: "skipped" });
  });

  it("rejects cycles and unknown nodes before dispatch", () => {
    expect(() =>
      validateWorkflow({
        ...workflow,
        edges: [
          { from: "c", to: "a" },
          { from: "a", to: "c" },
        ],
      }),
    ).toThrow(/cycle/i);
    expect(() =>
      validateWorkflow({ ...workflow, edges: [{ from: "missing", to: "a" }] }),
    ).toThrow(/unknown/i);
  });

  it("routes matching text and skips inactive branches while joining active results", async () => {
    const conditional: Workflow = {
      nodes: ["a", "b", "c", "d"].map((id) => ({
        id,
        botId: id,
        instruction: id,
      })),
      edges: [
        { from: "a", to: "b", contains: "yes" },
        { from: "a", to: "c", contains: "no" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
    };
    const result = await executeWorkflow(conditional, async (node, inputs) =>
      node.id === "a" ? "yes" : inputs.map((input) => input.result).join(" "),
    );
    expect(result.c).toEqual({ status: "skipped" });
    expect(result.d).toEqual({ status: "completed", result: "yes" });
  });

  it("rejects blank conditions", () => {
    expect(() =>
      validateWorkflow({
        ...workflow,
        edges: [{ from: "a", to: "c", contains: " " }],
      }),
    ).toThrow(/condition/i);
  });
});

it("starts at a selected input step and runs only its descendants", async () => {
  const { workflowFromEntry } = await import("./workflow");
  const selected = workflowFromEntry(workflow, "c");
  const seen: string[] = [];
  await executeWorkflow(selected, async (node) => {
    seen.push(node.id);
    return "ok";
  });
  expect(seen).toEqual(["c"]);
  const branch = workflowFromEntry(workflow, "a");
  expect(branch.nodes.map((node) => node.id)).toEqual(["a", "c"]);
  const results = await executeWorkflow(branch, async (node, inputs) =>
    node.id === "a"
      ? "entry result"
      : inputs.map((input) => input.result).join("+"),
  );
  expect(results.c).toEqual({ status: "completed", result: "entry result" });
  expect(() => workflowFromEntry(workflow, "missing")).toThrow(/input step/i);
});
