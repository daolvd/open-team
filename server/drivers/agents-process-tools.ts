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
    description: "Chief only: replace a managed bot's process in Design bot. Read get_bot_process first. Up to 24 steps; steps without inputs start together, branches run in parallel, a join waits (join any, all or a quorum number). An edge runs always, on contains text, on when (the source verdict: verdict == PASS, score >= 90, status == failed; and/or), on an AI condition, or otherwise. output verdict ends a step with JSON {verdict,score,notes,items} judged against criteria; loop {max} reruns the same or an earlier step with that output as feedback, join parallel consumers before looping. Exhaustion needs a matching conditional escalation, not unconditional delivery. forEach runs per listed item. model/effort per step: small to follow a plan, strong to plan or check. botId hands the step to a teammate, askBotId asks advice, approval asks the person over Telegram. Omit edges for sequential order. enabled and autoRun (run on delegated work and Tasks; autoRunWhen narrows it) keep their state when omitted. Saving never starts a run.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["bot_id", "design"],
      properties: {
        bot_id: BOT_ID,
        design: {
          type: "object", additionalProperties: false, required: ["identity", "method", "steps"],
          properties: {
            enabled: { type: "boolean", description: "Enable or disable the saved process. Omit to preserve its current state. Does not start a run." },
            autoRun: { type: "boolean" },
            autoRunWhen: { type: "string", maxLength: 2000 },
            identity: { type: "string", maxLength: 8000 },
            method: { type: "string", maxLength: 16000 },
            steps: { type: "array", maxItems: 24, items: {
              type: "object", additionalProperties: false, required: ["id", "title", "instruction"], properties: {
                id: { type: "string", pattern: "^[\\w-]+$", minLength: 1, maxLength: 80 },
                title: { type: "string", minLength: 1, maxLength: 160 },
                instruction: { type: "string", minLength: 1, maxLength: 8000 },
                askBotId: { ...BOT_ID, description: "Exact reachable bot id to ask for advice, including the supervising Chief. Omit to execute with the process owner." },
                botId: BOT_ID,
                model: { type: "string", maxLength: 200 },
                effort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh", "max"] },
                output: { type: "string", enum: ["text", "verdict"] },
                criteria: { type: "string", maxLength: 4000 },
                forEach: { type: "boolean" },
                concurrency: { type: "integer", minimum: 1, maximum: 8 },
                join: { type: "string", pattern: "^(any|all|[1-9][0-9]?)$" },
                approval: { type: "object", additionalProperties: false, required: ["timeoutHours", "default"], properties: {
                  timeoutHours: { type: "number", minimum: 0.1, maximum: 168 }, default: { type: "string", enum: ["approve", "reject"] },
                } },
                x: { type: "number", minimum: 0, maximum: 5000 }, y: { type: "number", minimum: 0, maximum: 5000 },
              },
            } },
            edges: { type: "array", maxItems: 552, items: {
              type: "object", additionalProperties: false, required: ["from", "to"], properties: {
                from: { type: "string", minLength: 1, maxLength: 80 }, to: { type: "string", minLength: 1, maxLength: 80 },
                contains: { type: "string", minLength: 1, maxLength: 1000 },
                when: { type: "string", minLength: 1, maxLength: 500 },
                condition: { type: "string", minLength: 1, maxLength: 2000 },
                otherwise: { type: "boolean", enum: [true] },
                loop: { type: "object", additionalProperties: false, required: ["max"], properties: { max: { type: "integer", minimum: 1, maximum: 10 } } },
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
