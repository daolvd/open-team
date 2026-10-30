import { z } from "zod";

const decision = z.object({
  matched: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
});

export function readWorkflowDecision(text: string): z.infer<typeof decision> {
  try {
    const json = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
    return decision.parse(JSON.parse(json));
  } catch {
    throw new Error("Invalid routing decision. Expected JSON with matched (boolean) and reason (text). Open the condition conversation and retry.");
  }
}
