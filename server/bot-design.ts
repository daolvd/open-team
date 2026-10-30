import { readFileSync } from "node:fs";
import { join } from "node:path";
import { botDesignSchema, botProcessWorkflow } from "../shared/bot-design.ts";
import { DATA_DIR } from "./config.ts";

export function botDesignPath(botId: string, dataDir = DATA_DIR): string {
  return join(dataDir, "bot-design", `${botId}.json`);
}

export function botProcessInstructions(botId: string): string {
  try {
    const saved = JSON.parse(readFileSync(botDesignPath(botId), "utf8"));
    const design = botDesignSchema.parse(saved.design);
    if (!design.enabled) return "";
    return `\n\nBot process:\nWho I am:\n${design.identity}\nHow I work:\n${design.method}\nSteps:\n${design.steps.map((step) => `${step.id} (${step.title}): ${step.instruction}`).join("\n")}\nConnections:\n${JSON.stringify(botProcessWorkflow(design).edges)}\nFollow these dependencies. Independent branches may run in parallel; join steps need their predecessor outputs. The app's Run process controls graph execution; ordinary chat receives this as instructions. Report the step you are working on and concrete outcomes. Do not claim to have run a tool or completed a step without evidence.`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
