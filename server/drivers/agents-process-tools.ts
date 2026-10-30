import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const PROCESS_TOOL_NAMES: ReadonlySet<string> = new Set(["get_bot_process", "set_bot_process"]);
const BOT_ID = { type: "string", pattern: "^[\\w-]+$", minLength: 1, maxLength: 128, description: "Exact bot id from list_team_setup." };

export const PROCESS_TOOL_DEFINITIONS = [
  {
    name: "get_bot_process",
    description: "Chief only: read a managed bot's saved process graph, enabled state, project directory and private memory locations. Read before editing; memory contents remain the worker's own.",
    inputSchema: { type: "object", additionalProperties: false, properties: { bot_id: BOT_ID }, required: ["bot_id"] },
  },
  {
    name: "set_bot_process",
    description: "Chief only: replace a managed bot's process in Design bot. Read get_bot_process first. Up to 24 steps; acyclic edges branch in parallel and join after predecessors; contains filters predecessor output. An optional step askBotId asks that reachable bot (including a Chief) for advice; instruction is the question and the reply becomes the step output. Use contains: NEEDS_DECISION to branch only when uncertain. Omit edges for sequential order. Preserves enabled; never starts a run. The person enables/runs it. For project workers use create_bot cwd or start_thread folder; memory_update saves their own durable memory across threads.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["bot_id", "design"],
      properties: {
        bot_id: BOT_ID,
        design: {
          type: "object", additionalProperties: false, required: ["identity", "method", "steps"],
          properties: {
            identity: { type: "string", maxLength: 8000 },
            method: { type: "string", maxLength: 16000 },
            steps: { type: "array", maxItems: 24, items: {
              type: "object", additionalProperties: false, required: ["id", "title", "instruction"], properties: {
                id: { type: "string", pattern: "^[\\w-]+$", minLength: 1, maxLength: 80 },
                title: { type: "string", minLength: 1, maxLength: 160 },
                instruction: { type: "string", minLength: 1, maxLength: 8000 },
                askBotId: { ...BOT_ID, description: "Exact reachable bot id to ask for advice, including the supervising Chief. Omit to execute with the process owner." },
                x: { type: "number", minimum: 0, maximum: 5000 }, y: { type: "number", minimum: 0, maximum: 5000 },
              },
            } },
            edges: { type: "array", maxItems: 552, items: {
              type: "object", additionalProperties: false, required: ["from", "to"], properties: {
                from: { type: "string", minLength: 1, maxLength: 80 }, to: { type: "string", minLength: 1, maxLength: 80 },
                contains: { type: "string", minLength: 1, maxLength: 1000 },
              },
            } },
          },
        },
      },
    },
  },
];

export async function callProcessTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const id = typeof args.bot_id === "string" ? args.bot_id.trim() : "";
  if (!/^[\w-]{1,128}$/.test(id)) return { text: "Use the exact bot_id from list_team_setup.", isError: true };
  if (name === "set_bot_process" && (!args.design || typeof args.design !== "object" || Array.isArray(args.design))) {
    return { text: "set_bot_process needs a design object with identity, method, steps and optional edges.", isError: true };
  }
  const { ok, body } = await context.client.apiResponse(`/api/internal/bot-process/${id}`, {
    method: name === "get_bot_process" ? "GET" : "PUT",
    ...(name === "set_bot_process" ? { body: JSON.stringify({ design: args.design }) } : {}),
  });
  return ok ? { text: JSON.stringify(body) } : { text: String(body.error ?? "Could not access this bot's process."), isError: true };
}
