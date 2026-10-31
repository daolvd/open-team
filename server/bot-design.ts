import { readFileSync } from "node:fs";
import { join } from "node:path";
import { botDesignSchema, botProcessEdges, type BotDesignEdge, type BotDesignStep } from "../shared/bot-design.ts";
import { DATA_DIR } from "./config.ts";

export function botDesignPath(botId: string, dataDir = DATA_DIR): string {
  return join(dataDir, "bot-design", `${botId}.json`);
}

function stepLine(step: BotDesignStep): string {
  const notes = [
    step.askBotId && `ask bot ${step.askBotId} for advice`,
    step.botId && `bot ${step.botId} does it`,
    step.model && `model ${step.model}`,
    step.output === "verdict" && "ends with a JSON verdict",
    step.forEach && "once per listed item",
    step.approval && "the person approves",
  ].filter(Boolean);
  return `${step.id} (${step.title})${notes.length ? ` [${notes.join("; ")}]` : ""}: ${step.instruction}${step.criteria ? `\n  Criteria: ${step.criteria}` : ""}`;
}

function edgeLine(edge: BotDesignEdge): string {
  const condition = edge.contains !== undefined ? `output contains "${edge.contains}"` : edge.when ? edge.when
    : edge.condition ? `if ${edge.condition}` : edge.otherwise ? "otherwise" : "always";
  return `${edge.from} -> ${edge.to}: ${condition}${edge.loop ? ` (loop back, at most ${edge.loop.max} times)` : ""}`;
}

export function botProcessInstructions(botId: string): string {
  try {
    const saved = JSON.parse(readFileSync(botDesignPath(botId), "utf8"));
    const design = botDesignSchema.parse(saved.design);
    if (!design.enabled) return "";
    return `\n\nBot process:\nWho I am:\n${design.identity}\nHow I work:\n${design.method}\nSteps:\n${design.steps.map(stepLine).join("\n")}\nConnections:\n${botProcessEdges(design).map(edgeLine).join("\n")}\n${design.autoRun ? "Delegated work and Tasks for you run this graph step by step automatically. " : ""}Follow these dependencies when you work in chat. Independent branches may run in parallel; join steps need their predecessor outputs; a loop repeats its stretch until its check passes or its limit is reached. Report the step you are working on and concrete outcomes. Do not claim to have run a tool or completed a step without evidence.`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
