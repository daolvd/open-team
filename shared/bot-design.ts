import { z } from "zod";
import { validateProcessGraph, type ProcessGraph, type ProcessStepResult, type ProcessVerdict } from "./process-run.ts";
import { EFFORT_LEVELS } from "./wire.ts";

const BOT_ID = z.string().regex(/^[\w-]+$/).max(128);

/** Missing edges preserve legacy sequential execution; explicit edges define a graph, including independent roots. */
export const botDesignSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Delegated work and Tasks addressed to this bot run the process graph instead of one chat turn. */
    autoRun: z.boolean().default(false),
    /** When set, only work this rule describes runs the process; other work stays an ordinary turn. */
    autoRunWhen: z.string().trim().max(2000).default(""),
    identity: z.string().max(8000).default(""),
    method: z.string().max(16000).default(""),
    steps: z
      .array(
        z.object({
          id: z
            .string()
            .regex(/^[\w-]+$/)
            .max(80),
          title: z.string().trim().min(1).max(160),
          instruction: z.string().trim().min(1).max(8000),
          /** Ask this reachable bot for advice in a separate conversation; its reply becomes the step output. */
          askBotId: BOT_ID.optional(),
          /** This reachable teammate does the step's work with its own tools; its reply becomes the step output. */
          botId: BOT_ID.optional(),
          /** Run this step on another model of the executor's engine, such as a small fast model for plain execution. */
          model: z.string().trim().min(1).max(200).optional(),
          effort: z.enum(EFFORT_LEVELS).optional(),
          /** verdict: the step ends with a JSON verdict that connections can branch on. */
          output: z.enum(["text", "verdict"]).optional(),
          /** What the step's work must satisfy; a verdict step judges against it. */
          criteria: z.string().trim().max(4000).optional(),
          /** Run once per item the incoming verdicts list. */
          forEach: z.boolean().optional(),
          concurrency: z.number().int().min(1).max(8).optional(),
          join: z.preprocess((value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
            z.union([z.enum(["any", "all"]), z.number().int().min(1).max(24)])).optional(),
          /** A person's decision instead of a bot's work: asked over Telegram, the default applies after the timeout. */
          approval: z.object({
            timeoutHours: z.number().min(0.1).max(168),
            default: z.enum(["approve", "reject"]),
          }).optional(),
          x: z.number().min(0).max(5000).optional(),
          y: z.number().min(0).max(5000).optional(),
        }),
      )
      .max(24)
      .default([]),
    edges: z.array(z.object({
      from: z.string(),
      to: z.string(),
      contains: z.string().trim().min(1).max(1000).optional(),
      when: z.string().trim().min(1).max(500).optional(),
      condition: z.string().trim().min(1).max(2000).optional(),
      otherwise: z.literal(true).optional(),
      loop: z.object({ max: z.number().int().min(1).max(10) }).optional(),
    })).max(552).optional(),
  })
  .refine(
    (design) =>
      new Set(design.steps.map((step) => step.id)).size === design.steps.length,
    "Step IDs must be unique",
  ).superRefine((design, context) => {
    for (const [index, step] of design.steps.entries()) {
      const problem = step.askBotId && step.botId ? "A step either asks a bot for advice or hands it the work, not both"
        : step.approval && (step.askBotId || step.botId || step.forEach || step.model) ? "An approval step is answered by the person, not run by a bot"
          : undefined;
      if (problem) context.addIssue({ code: "custom", message: problem, path: ["steps", index] });
    }
    try { validateProcessGraph(botProcessGraph(design)); }
    catch (error) { context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error), path: ["edges"] }); }
  });

export type BotDesign = z.infer<typeof botDesignSchema>;
export type BotDesignStep = BotDesign["steps"][number];
export type BotDesignEdge = NonNullable<BotDesign["edges"]>[number];
export type BotProcessStepRun = {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "skipped";
  botId?: string;
  threadId?: string;
  startedAt?: number;
  endedAt?: number;
  output?: string;
  error?: string;
  /** How many times the step ran; above one when a loop sent work back to it. */
  attempts?: number;
  verdict?: ProcessVerdict;
};
/** Run snapshots retain the definition that actually ran, even after editing the bot. */
export type BotProcessRun = {
  id: string;
  input: string;
  design: BotDesign;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number;
  threadId?: string;
  /** Who started it: the Run process button, or work that arrived for the bot. */
  source?: "manual" | "work";
  output?: string;
  steps: BotProcessStepRun[];
};
export type BotProcessConsultant = { id: string; name: string };
export type BotDesignState = { design: BotDesign; runs: BotProcessRun[] };

export function botProcessEdges(design: { steps: { id: string }[]; edges?: BotDesignEdge[] }): BotDesignEdge[] {
  return design.edges ?? design.steps.slice(1).map((step, index) => ({ from: design.steps[index]!.id, to: step.id }));
}

export function botProcessGraph(design: { steps: Pick<BotDesignStep, "id" | "forEach" | "concurrency" | "join">[]; edges?: BotDesignEdge[] }): ProcessGraph {
  return {
    steps: design.steps.map(({ id, forEach, concurrency, join }) => ({ id, ...(forEach ? { forEach } : {}), ...(concurrency ? { concurrency } : {}), ...(join !== undefined ? { join } : {}) })),
    edges: botProcessEdges(design),
  };
}

/** The process's final answer: the last completed step with no completed successor, else every completed sink. */
export function botProcessOutput(design: BotDesign, results: Record<string, ProcessStepResult>): string {
  const edges = botProcessEdges(design).filter((edge) => !edge.loop);
  const ends = design.steps.filter((step) => results[step.id]?.status === "completed" &&
    !edges.some((edge) => edge.from === step.id && results[edge.to]?.status === "completed"));
  return ends.map((step) => {
    const result = results[step.id] as Extract<ProcessStepResult, { status: "completed" }>;
    return ends.length > 1 ? `## ${step.title}\n${result.text}` : result.text;
  }).join("\n\n");
}

/** How the graph runs, for whoever writes a process: the setup assistant and a Chief's set_bot_process. */
export const PROCESS_AUTHORING_GUIDE = "Maximum 24 steps. Steps with no incoming connection start together; several outgoing connections branch in parallel; a step with several incoming connections joins them (join any by default, all, or a number for a quorum such as 2 of 3 reviewers). A connection is unconditional, contains (exact output text), when (a check on the source step's verdict: verdict == PASS, score >= 90, status == failed, joined with and/or), condition (an AI-judged sentence) or otherwise:true (none of the source's other connections matched). A step with output:\"verdict\" ends with JSON {verdict,score,notes,items} and its criteria say what PASS means. A loop connection {loop:{max}} goes back to the same or an earlier step on the path and re-runs it with the source's output as feedback, at most max times; join all parallel consumers before looping to their shared input. At exhaustion a matching conditional exit must escalate; an unconditional exit cannot deliver a failed review. forEach runs a step once per item the incoming verdict lists, concurrency at a time. model/effort run a step on a lighter or stronger model of the executor's engine. botId hands one step's work to a reachable teammate; askBotId only asks it for advice. approval:{timeoutHours,default} asks the person over Telegram and applies the default when they do not answer. Prefer four layers: strong-model plan and score >=90 without veto; small-model build and tool checks; parallel independent reviews of the same revision with an aggregate verdict; batched owner decisions. Quorum counts matched inputs, not PASS votes; never hide a critical veto. Minor findings that meet acceptance become follow-ups. Required owner approval uses default reject. Fix FAIL with a bounded loop, then an explicit escalation.";
