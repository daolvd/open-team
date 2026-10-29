import { expect, it, vi } from "vitest";
import type { Message } from "./store.ts";
import { runWorkflowConversation } from "./workflow-conversation.ts";

function fixture(live = false) {
  const messages: Message[] = [];
  let check = () => {};
  let answer!: (text: string) => void;
  const answered = new Promise<string>(resolve => { answer = resolve; });
  const interaction = { file: vi.fn(), notify: vi.fn(), ask: vi.fn(() => answered) };
  const turn = vi.fn(async (_prompt: string) => {
    if (turn.mock.calls.length === 1) {
      messages.push({ id: "q", role: "bot", at: 0, kind: "options", card: { title: "Brief", subtitle: "Name?", requestId: "r", requestType: "question", options: [] } });
      check();
      if (live) await answered;
      else return { ok: true, text: "Waiting" };
    }
    messages.push({ id: "output", role: "bot", at: 0, kind: "text", text: "Done" });
    return { ok: true, text: "Done" };
  });
  const outputs = vi.fn(async () => {});
  const cancel = vi.fn();
  const run = () => runWorkflowConversation({ prompt: "Build", messages: () => messages, subscribe: callback => { check = callback; return vi.fn(); }, turn, answer: async () => { messages[0]!.card!.answered = "answer"; return live; }, interaction, outputs, cancel });
  return { run, interaction, turn, outputs, answer, cancel, messages };
}

it("continues the same conversation after a completed turn's phone form", async () => {
  const f = fixture();
  const result = f.run();
  await expect.poll(() => f.interaction.ask.mock.calls.length).toBe(1);
  f.answer("Alice");
  await expect(result).resolves.toBe("Done");
  expect(f.turn).toHaveBeenCalledTimes(2);
  expect(f.turn.mock.calls[1]).toEqual([expect.stringContaining("Alice")]);
  expect(f.outputs).toHaveBeenCalledTimes(1);
  expect(f.cancel).not.toHaveBeenCalled();
});
it("answers a live tool without dispatching a second turn", async () => {
  const f = fixture(true);
  const result = f.run();
  await expect.poll(() => f.interaction.ask.mock.calls.length).toBe(1);
  f.answer("Alice");
  await expect(result).resolves.toBe("Done");
  expect(f.turn).toHaveBeenCalledTimes(1);
});
it("cancels a live waiting engine if Telegram closes the form", async () => {
  const f = fixture(true);
  f.interaction.ask.mockImplementation(async () => { throw new Error("Disconnected"); });
  await expect(f.run()).rejects.toThrow("Disconnected");
  expect(f.cancel).toHaveBeenCalledOnce();
});
it("does not forward permission cards as phone forms", async () => {
  const f = fixture();
  f.turn.mockImplementation(async () => {
    f.messages.push({ id: "permission", role: "bot", at: 0, kind: "options", card: { title: "Allow command", subtitle: "Shell", tool: "Bash", requestType: "permission", requestId: "p", options: ["Allow"] } });
    return { ok: true, text: "Done" };
  });
  await f.run();
  expect(f.interaction.ask).not.toHaveBeenCalled();
});
