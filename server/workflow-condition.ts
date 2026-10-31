import { z } from "zod";

const decision = z.object({
  matched: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
});
const selection = z.object({
  selected: z.array(z.string()).max(32),
  reason: z.string().trim().min(1).max(1000),
});

function readJsonReply(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1"));
}

export function readWorkflowDecision(text: string): z.infer<typeof decision> {
  try {
    return decision.parse(readJsonReply(text));
  } catch {
    throw new Error("Invalid routing decision. Expected JSON with matched (boolean) and reason (text). Open the condition conversation and retry.");
  }
}

export function readWorkflowSelection(text: string, candidates: readonly string[]): z.infer<typeof selection> {
  let parsed: z.infer<typeof selection>;
  try {
    parsed = selection.parse(readJsonReply(text));
  } catch {
    throw new Error("Invalid request routing. Expected JSON with selected (step ids) and reason (text). Open the routing conversation and retry.");
  }
  const unknown = parsed.selected.filter(id => !candidates.includes(id));
  if (unknown.length) throw new Error(`Request routing chose unknown steps: ${unknown.join(", ")}. Open the routing conversation and retry.`);
  return { selected: [...new Set(parsed.selected)], reason: parsed.reason };
}
