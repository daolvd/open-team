// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { botDesignSchema, type BotDesignState } from "../../shared/bot-design";
import { useBotDesign } from "./bot-design-state";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ api }));
let root: Root;
let model: ReturnType<typeof useBotDesign>;
let saved: BotDesignState;
const state = (identity: string): BotDesignState => ({ design: botDesignSchema.parse({ identity }), runs: [] });
function Probe({ botId }: { botId: string }) {
  model = useBotDesign(botId);
  return null;
}
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(1800); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  saved = state("Original");
  api.mockReset().mockImplementation(async (_path: string, options?: { body: string }) => {
    if (options) saved = { design: botDesignSchema.parse(JSON.parse(options.body)), runs: [] };
    return { ...saved, activity: [] };
  });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows Chief edits automatically while preserving the person's unsaved draft", async () => {
  await act(async () => root.render(createElement(Probe, { botId: "worker" })));
  expect(model.draft.identity).toBe("Original");
  saved = state("Chief revision");
  await poll();
  expect(model.draft.identity).toBe("Chief revision");
  expect(model.dirty).toBe(false);

  act(() => model.setDraft(current => ({ ...current, identity: "Local draft" })));
  saved = state("Another Chief revision");
  await poll();
  expect(model.snapshot?.design.identity).toBe("Another Chief revision");
  expect(model.draft.identity).toBe("Local draft");
  expect(model.dirty).toBe(true);

  await act(async () => { await model.save(); });
  expect(model.dirty).toBe(false);
  saved = state("Chief after save");
  await poll();
  expect(model.draft.identity).toBe("Chief after save");
  expect(model.dirty).toBe(false);
});

it("loads the next bot's process instead of carrying over the previous bot's draft", async () => {
  await act(async () => root.render(createElement(Probe, { botId: "first" })));
  act(() => model.setDraft(current => ({ ...current, identity: "First bot draft" })));
  saved = state("Second bot process");
  await act(async () => root.render(createElement(Probe, { botId: "second" })));
  expect(model.draft.identity).toBe("Second bot process");
  expect(model.dirty).toBe(false);
  expect(api).toHaveBeenLastCalledWith("/api/bots/second/design");
});
