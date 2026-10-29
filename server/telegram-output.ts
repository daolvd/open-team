import type { AskQuestion } from "../shared/ask-question.ts";

export type TelegramFile = { name: string; mime: string; data: Uint8Array };
export type WorkflowInteraction = {
  notify(text: string): Promise<void>;
  file(file: TelegramFile): Promise<void>;
  ask(title: string, questions: AskQuestion[], signal?: AbortSignal): Promise<string>;
};
