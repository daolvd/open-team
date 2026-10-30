import { expect, it, vi } from "vitest";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

it("advertises process authoring only to Chiefs and marks only its read tool read-only", () => {
  for (const chief of ["0", "1"]) {
    const tools = availableTools(catalogProfileFromEnv({ OMB_CHIEF_OF_STAFF: chief }));
    const read = tools.find((tool) => tool.name === "get_bot_process");
    const write = tools.find((tool) => tool.name === "set_bot_process");
    expect(Boolean(read)).toBe(chief === "1");
    expect(Boolean(write)).toBe(chief === "1");
    if (read) expect(read).toMatchObject({ annotations: { readOnlyHint: true } });
    if (write) expect(write).not.toMatchObject({ annotations: { readOnlyHint: true } });
  }
});

it("maps the target and design without passing forged sender identity or enabling execution", async () => {
  const apiResponse = vi.fn(async () => ({ ok: true, status: 200, body: { design: { enabled: false } } }));
  const context: ToolCallContext = { botId: "chief", threadId: "thread", depth: 0, externalRuntime: false, sharedComputers: false,
    client: { api: async () => ({}), apiResponse } };
  const design = { identity: "Worker", method: "Verify findings", steps: [], edges: [] };
  expect((await callTool("get_bot_process", { bot_id: "worker" }, context)).isError).toBeFalsy();
  expect((await callTool("set_bot_process", { bot_id: "worker", design, fromBotId: "forged", enabled: true }, context)).isError).toBeFalsy();
  expect(apiResponse.mock.calls).toEqual([
    ["/api/internal/bot-process/worker", { method: "GET" }],
    ["/api/internal/bot-process/worker", { method: "PUT", body: JSON.stringify({ design }) }],
  ]);
  for (const args of [{}, { bot_id: "../escape" }, { bot_id: "worker" }]) {
    expect((await callTool("set_bot_process", args, context)).isError).toBe(true);
  }
  expect(apiResponse).toHaveBeenCalledTimes(2);
});

it("returns server refusals as tool errors", async () => {
  const result = await callTool("get_bot_process", { bot_id: "worker" }, {
    botId: "chief", threadId: "thread", depth: 0, externalRuntime: false, sharedComputers: false,
    client: { api: async () => ({}), apiResponse: async () => ({ ok: false, status: 403, body: { error: "Outside Chief authority" } }) },
  });
  expect(result).toEqual({ text: "Outside Chief authority", isError: true });
});
