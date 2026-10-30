import { join } from "node:path";
import { z } from "zod";
import { botDesignSchema } from "../../shared/bot-design.ts";
import { chiefLevel } from "../chief-level.ts";
import { canManage } from "../peer-roster.ts";
import type { BotRecord } from "../store.ts";
import type { createBotDesignService } from "./bot-design.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createInternalBotProcessRoutes(deps: {
  dataDir: string;
  bot(): BotRecord | null;
  bots(): readonly BotRecord[];
  requireActive(): void;
  designs: Pick<ReturnType<typeof createBotDesignService>, "read" | "save">;
}): RouteHandler {
  const targetFor = (id: string) => {
    const caller = deps.bot();
    const target = deps.bots().find((bot) => bot.id === id);
    return caller && !caller.hidden && chiefLevel(caller) && target && !target.hidden &&
      (caller.id === target.id || canManage(caller, target)) ? target : null;
  };
  return async ({ req, res, path, method, json, readBody }) => {
    const match = path.match(/^\/api\/internal\/bot-process\/([\w-]{1,128})$/);
    if (!match) return PASS;
    deps.requireActive();
    if (!targetFor(match[1]!)) return json(res, 403, { error: "Only an active Chief may configure a bot within its authority and reach" });
    if (method !== "GET" && method !== "PUT") return json(res, 405, { error: "Method not allowed" });
    const body = method === "PUT" ? z.object({ design: z.record(z.string(), z.unknown()) }).strict().safeParse(await readBody(req)) : undefined;
    deps.requireActive();
    const target = targetFor(match[1]!);
    if (!target) return json(res, 403, { error: "The Chief can no longer configure this bot" });
    let { design } = deps.designs.read(target.id);
    if (body) {
      if (!body.success) return json(res, 400, { error: "Provide a process design object" });
      const parsed = botDesignSchema.safeParse({ ...body.data.design, enabled: design.enabled });
      if (!parsed.success) return json(res, 400, { error: parsed.error.message });
      design = deps.designs.save(target.id, parsed.data).design;
    }
    const folder = join(deps.dataDir, "workspaces", target.id);
    return json(res, 200, {
      botId: target.id, name: target.name, design, projectFolder: target.cwd || null,
      memory: { enabled: target.memoryEnabled !== false, folder, index: join(folder, "MEMORY.md") },
      detail: `${method === "PUT" ? "Saved. " : ""}Inspect the graph in Design bot. The enabled switch is unchanged; the person enables and runs the process. Each bot keeps its own durable memory across threads and working directories with memory_update, memory_log and session_search. Use create_bot with cwd for a new project worker, or start_thread with folder for an existing worker.`,
    });
  };
}
