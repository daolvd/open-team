import { z } from "zod";
import { validateWorkflow, type Workflow } from "./workflow.ts";

/** Missing edges preserve legacy sequential execution; explicit edges define a DAG, including independent roots. */
export const botDesignSchema = z
  .object({
    enabled: z.boolean().default(false),
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
          askBotId: z.string().regex(/^[\w-]+$/).max(128).optional(),
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
    })).max(552).optional(),
  })
  .refine(
    (design) =>
      new Set(design.steps.map((step) => step.id)).size === design.steps.length,
    "Step IDs must be unique",
  ).superRefine((design, context) => {
    try { validateWorkflow(botProcessWorkflow(design)); }
    catch (error) { context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error), path: ["edges"] }); }
  });

export type BotDesign = z.infer<typeof botDesignSchema>;
export type BotProcessStepRun = {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "skipped";
  botId?: string;
  threadId?: string;
  startedAt?: number;
  endedAt?: number;
  output?: string;
  error?: string;
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
  steps: BotProcessStepRun[];
};
export type BotProcessConsultant = { id: string; name: string };
export type BotDesignState = { design: BotDesign; runs: BotProcessRun[] };

export function botProcessWorkflow(design: { steps: { id: string; instruction: string }[]; edges?: Workflow["edges"] }): Workflow {
  return {
    nodes: design.steps.map((step) => ({ ...step, botId: "process" })),
    edges: design.edges ?? design.steps.slice(1).map((step, index) => ({ from: design.steps[index]!.id, to: step.id })),
  };
}
