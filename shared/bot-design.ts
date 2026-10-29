import { z } from "zod";

/** Editable per-bot instructions and the ordered steps used by a process run. */
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
        }),
      )
      .max(24)
      .default([]),
  })
  .refine(
    (design) =>
      new Set(design.steps.map((step) => step.id)).size === design.steps.length,
    "Step IDs must be unique",
  );

export type BotDesign = z.infer<typeof botDesignSchema>;
export type BotProcessStepRun = {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
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
export type BotDesignState = { design: BotDesign; runs: BotProcessRun[] };
