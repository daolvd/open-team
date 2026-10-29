import { isPersistentQuestionCard, questionAnswersByQuestion } from "../shared/ask-question.ts";
import type { Message } from "./store.ts";
import type { HostTurnResult } from "./coordinator.ts";
import type { WorkflowInteraction } from "./telegram-output.ts";
import { needsInputQuestion } from "./runtime-coordinator.ts";

export async function runWorkflowConversation(deps: {
  prompt: string;
  messages(): Message[];
  subscribe(check: () => void): () => void;
  turn(prompt: string): Promise<HostTurnResult>;
  answer(message: Message, answer: string): Promise<boolean>;
  outputs(messages: Message[]): Promise<void>;
  cancel(): void;
  interaction?: WorkflowInteraction;
}): Promise<string> {
  const baseline = new Map(deps.messages().map(message => [message.id, JSON.stringify(message)]));
  const handled = new Set<string>();
  const cancellation = new AbortController();
  let waiting = Promise.resolve();
  let continuation = "";
  let fail: (error: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => { fail = reject; });
  const check = () => {
    if (!deps.interaction || cancellation.signal.aborted) return;
    for (const message of deps.messages()) {
      const card = message.card;
      if (message.kind !== "options" || baseline.has(message.id) || !card?.requestId || card.answered || card.dismissed || card.expired ||
        !isPersistentQuestionCard(card) || handled.has(message.id)) continue;
      handled.add(message.id);
      waiting = waiting.then(async () => {
        const current = deps.messages().find(row => row.id === message.id)?.card;
        if (!current || current.answered || current.dismissed || current.expired) return;
        const questions = card.questionRequest?.questions ?? [{ question: card.subtitle || card.title, options: card.options.map(label => ({ label })), ...(card.fixedOptions ? { custom: false as const } : {}) }];
        const formatted = await deps.interaction!.ask(card.title, questions, cancellation.signal);
        const answer = card.questionRequest ? formatted : questionAnswersByQuestion(formatted, questions)[questions[0]!.question]!;
        if (!await deps.answer(message, answer)) continuation += `\n${formatted}`;
      }).catch(error => { fail(error); });
    }
  };
  const unsubscribe = deps.subscribe(check);
  try {
    let prompt = deps.prompt;
    for (let round = 0; round < 20; round++) {
      continuation = "";
      const outcome = await Promise.race([deps.turn(prompt), failed]);
      check();
      if (!outcome.ok) throw new Error(outcome.text || "Workflow step failed");
      await Promise.race([waiting, failed]);
      if (continuation) { prompt = continuation.trim(); continue; }
      const question = needsInputQuestion(outcome.text);
      if (question && deps.interaction) {
        prompt = await deps.interaction.ask("Bot needs your input / Bot cần bạn trả lời", [{ question, options: [] }], cancellation.signal);
        continue;
      }
      await deps.outputs(deps.messages().filter(message => message.role === "bot" && baseline.get(message.id) !== JSON.stringify(message)));
      if (outcome.cards) throw new Error(`${outcome.cards.question}\nOpen the app to complete this setup.`);
      return outcome.text;
    }
    throw new Error("This conversation reached the limit of 20 follow-up forms. Continue in the app.");
  } catch (error) {
    deps.cancel();
    throw error;
  } finally {
    unsubscribe();
    cancellation.abort();
  }
}
