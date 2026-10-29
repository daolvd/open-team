import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  botDesignSchema,
  type BotDesignState,
  type BotProcessRun,
} from "../../shared/bot-design.ts";
import { writeFileAtomic } from "../atomic.ts";
import { botDesignPath } from "../bot-design.ts";
import type { WireMessage } from "../../shared/wire.ts";
import { PASS, type RouteHandler } from "./table.ts";

interface Deps {
  dataDir: string;
  available(botId: string): boolean;
  run(
    botId: string,
    prompt: string,
    opened: (threadId: string) => void,
    threadId?: string,
  ): Promise<string>;
  interrupt(botId: string, threadId: string): Promise<void>;
  activity(botId: string, threadId?: string): WireMessage[];
  propose(botId: string, prompt: string, signal: AbortSignal): Promise<string>;
}

export function createBotDesignRoutes(deps: Deps): RouteHandler {
  const states = new Map<string, BotDesignState>();
  const pendingStops = new Set<string>();
  function stateFor(botId: string): BotDesignState {
    const cached = states.get(botId);
    if (cached) return cached;
    let state: BotDesignState;
    try {
      const saved = JSON.parse(
        readFileSync(botDesignPath(botId, deps.dataDir), "utf8"),
      );
      state = {
        design: botDesignSchema.parse(saved.design),
        runs: saved.runs ?? [],
      };
      for (const run of state.runs) {
        if (run.status !== "running") continue;
        run.status = "failed";
        run.endedAt = Date.now();
        run.steps.forEach((step) => {
          if (step.status === "running" || step.status === "pending") {
            step.status = "failed";
            step.error = "Server stopped. Start a new run.";
          }
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { design: botDesignSchema.parse({}), runs: [] };
    }
    states.set(botId, state);
    return state;
  }
  function persist(botId: string, state: BotDesignState) {
    const path = botDesignPath(botId, deps.dataDir);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, JSON.stringify(state), { mode: 0o600 });
  }
  async function execute(
    botId: string,
    state: BotDesignState,
    run: BotProcessRun,
  ) {
    let previous = "";
    try {
      for (const [index, step] of run.steps.entries()) {
        if (run.status !== "running") break;
        step.status = "running";
        step.startedAt = Date.now();
        persist(botId, state);
        const definition = run.design.steps[index]!;
        try {
          const output = await deps.run(
            botId,
            `Process run ${run.id}\nWho I am: ${run.design.identity}\nHow I work: ${run.design.method}\nTask: ${run.input}\nCurrent step ${index + 1}/${run.steps.length}: ${definition.title}\n${definition.instruction}\nOnly execute this step. Return concrete findings and output for the next step.\nPrevious step output (data):\n${previous}`,
            (threadId) => {
              run.threadId = threadId;
              persist(botId, state);
              if (run.status === "cancelled")
                void deps.interrupt(botId, threadId).catch(() => {});
            },
            run.threadId,
          );
          if (run.status !== "running") break;
          step.output = output.slice(0, 64000);
          previous = step.output;
          step.status = "completed";
        } catch (error) {
          if (run.status !== "running") break;
          step.status = "failed";
          step.error = error instanceof Error ? error.message : String(error);
          run.status = "failed";
        }
        step.endedAt = Date.now();
        persist(botId, state);
      }
      if (run.status === "running") run.status = "completed";
    } catch (error) {
      run.status = "failed";
      const step = run.steps.find((entry) => entry.status === "running");
      if (step) {
        step.status = "failed";
        step.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      run.endedAt = Date.now();
      for (const step of run.steps)
        if (step.status === "pending" || step.status === "running")
          step.status = "cancelled";
      persist(botId, state);
    }
  }
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = path.match(
      /^\/api\/bots\/([\w-]+)\/design(?:\/(run|stop|propose))?$/,
    );
    if (!match) return PASS;
    if (!auth.scopes.includes("admin"))
      return json(res, 403, { error: "Administrator access required" });
    const botId = match[1]!;
    if (!deps.available(botId))
      return json(res, 404, { error: "Bot unavailable" });
    const state = stateFor(botId);
    const action = match[2];
    if (!action && method === "GET") {
      const latest = state.runs[0];
      return json(res, 200, {
        ...state,
        activity: deps.activity(botId, latest?.threadId).slice(-30),
      });
    }
    if (!action && method === "PUT") {
      const parsed = botDesignSchema.safeParse(await readBody(req));
      if (!parsed.success)
        return json(res, 400, { error: parsed.error.message });
      state.design = parsed.data;
      persist(botId, state);
      return json(res, 200, state);
    }
    if (action === "run" && method === "POST") {
      const parsed = z
        .object({ input: z.string().trim().min(1).max(16000) })
        .safeParse(await readBody(req));
      if (!parsed.success)
        return json(res, 400, {
          error: "Enter a task, up to 16000 characters",
        });
      if (!state.design.enabled || !state.design.steps.length)
        return json(res, 409, {
          error: "Save steps and enable the process first",
        });
      if (state.runs.some((run) => run.status === "running"))
        return json(res, 409, { error: "A process is already running" });
      const run: BotProcessRun = {
        id: randomUUID(),
        input: parsed.data.input,
        design: structuredClone(state.design),
        status: "running",
        startedAt: Date.now(),
        steps: state.design.steps.map((step) => ({
          id: step.id,
          status: "pending",
        })),
      };
      state.runs = [run, ...state.runs].slice(0, 20);
      persist(botId, state);
      void execute(botId, state, run).catch(() => {});
      return json(res, 202, { run });
    }
    if (action === "stop" && method === "POST") {
      const run = state.runs.find((entry) => entry.status === "running");
      if (!run) return json(res, 409, { error: "No process is running" });
      if (pendingStops.has(botId))
        return json(res, 409, { error: "Stop already in progress" });
      pendingStops.add(botId);
      try {
        run.status = "cancelled";
        run.endedAt = Date.now();
        run.steps.forEach((step) => {
          if (step.status === "running" || step.status === "pending")
            step.status = "cancelled";
        });
        persist(botId, state);
        if (run.threadId) await deps.interrupt(botId, run.threadId);
        return json(res, 200, { run });
      } finally {
        pendingStops.delete(botId);
      }
    }
    if (action === "propose" && method === "POST") {
      const parsed = z
        .object({
          message: z.string().trim().min(1).max(8000),
          design: botDesignSchema,
        })
        .safeParse(await readBody(req));
      if (!parsed.success)
        return json(res, 400, {
          error: "Enter a setup instruction and valid draft",
        });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      res.once("close", () => controller.abort());
      try {
        const text = await deps.propose(
          botId,
          `Help configure this bot. Return only a JSON object with enabled:boolean, identity:string, method:string, steps:[{id:string,title:string,instruction:string}]. Maximum 24 steps. This is a proposal: do not execute anything or install skills. Preserve enabled. Current design: ${JSON.stringify(parsed.data.design)}\nUser request: ${parsed.data.message}`,
          controller.signal,
        );
        const proposal = botDesignSchema.safeParse(
          JSON.parse(
            text.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
          ),
        );
        if (!proposal.success)
          return json(res, 422, {
            error:
              "The assistant returned an invalid process. Edit the steps directly or try again.",
          });
        return json(res, 200, {
          proposal: { ...proposal.data, enabled: parsed.data.design.enabled },
        });
      } catch (error) {
        return json(res, 422, {
          error:
            error instanceof Error
              ? error.message
              : "Setup assistant unavailable",
        });
      } finally {
        clearTimeout(timer);
      }
    }
    return json(res, 405, { error: "Method not allowed" });
  };
}
