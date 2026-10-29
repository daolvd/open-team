import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import type { ProviderInstance, RuntimeEvent, SendTurnInput } from "../contracts.ts";
import { ZcodeDriver } from "./zcode.ts";

it.skipIf(process.env.OMB_ZCODE_NATIVE_E2E !== "1")("runs native Zcode against an isolated provider, selected MCP and resumed session", async () => {
  const root = mkdtempSync(join(tmpdir(), "omb-zcode-native-"));
  const calls = join(root, "mcp-call.json");
  const requests: Array<{ messages: Array<{ role: string; content?: unknown }>; tools?: Array<{ function: { name: string } }> }> = [];
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const tool = input.tools?.find((entry: { function: { name: string } }) => entry.function.name.includes("read_notes"));
    const invoke = requests.length === 1 && tool;
    const toolCall = { id: "call_fixture", type: "function", function: { name: tool?.function.name ?? "", arguments: "{}" } };
    const message = invoke ? { role: "assistant", content: null, tool_calls: [toolCall] }
      : { role: "assistant", content: "Fixture Zcode completed." };
    const finishReason = invoke ? "tool_calls" : "stop";
    if (input.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const delta = invoke ? { ...message, tool_calls: [{ index: 0, ...toolCall }] } : message;
      for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: finishReason }]) {
        response.write(`data: ${JSON.stringify({ id: "chat_fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [choice] })}\n\n`);
      }
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "chat_fixture", object: "chat.completion", created: 1, model: "fixture-model", choices: [{ index: 0, message, finish_reason: finishReason }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }));
    }
  });
  let instance: ProviderInstance | undefined;
  try {
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture provider port");
    const config = join(root, "provider.json");
    writeFileSync(config, JSON.stringify({ schemaVersion: 1, config: {
      providerConfigRules: { providerRules: [{ providerId: "fixture", providerName: "Fixture", enabled: true, config: {
        group: "standard-personal", access: { type: "api-key", apiKey: "fixture" },
        api: { type: "openai-chat-completions", baseUrl: `http://127.0.0.1:${address.port}/v1` }, personalModelIds: ["fixture-model"],
      } }] }, modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      defaultModelSelection: { providerId: "fixture", modelId: "fixture-model" },
    } }));
    instance = await ZcodeDriver.create({ instanceId: "native-zcode", displayName: "Native fixture", enabled: true,
      environment: { HOME: root, USERPROFILE: root, ZCODE_DATA_BASE_DIR: root,
        ZCODE_SESSION_DB_PATH: join(root, "sessions.db"), ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: config,
        ZCODE_CLI_CREDENTIALS_FILE: join(root, "credentials.json") },
      config: ZcodeDriver.decodeConfig({ cli: process.env.OMB_ZCODE_CLI ?? "zcode", model: "fixture/fixture-model" }),
    });
    const run = async (extra: Partial<SendTurnInput> = {}) => {
      const events: RuntimeEvent[] = [];
      const stop = instance!.adapter.onEvent(event => events.push(event));
      try {
        await instance!.adapter.sendTurn({ threadId: "native-zcode", cwd: root, text: "First fixture input", approvalMode: "full", integrations: {
          custom: { notes: { command: process.execPath, args: ["--experimental-strip-types", resolve("server/testing/fake-mcp-server.ts")], env: { FAKE_MCP_CALL_FILE: calls } } },
        }, ...extra });
        await expect.poll(() => events.find(event => event.type === "turn.completed"), { timeout: 40_000 }).toBeDefined();
        expect(events.at(-1), JSON.stringify(events)).toMatchObject({ type: "turn.completed", ok: true });
        return events;
      } finally { stop(); }
    };
    const first = await run();
    expect(requests.flatMap(request => request.tools ?? []).some(tool => tool.function.name.includes("read_notes"))).toBe(true);
    expect(existsSync(calls)).toBe(true);
    expect(JSON.parse(readFileSync(calls, "utf8"))).toMatchObject({ name: "read_notes" });
    const session = first.find(event => event.type === "session.started");
    if (!session || session.type !== "session.started") throw new Error("Missing native session");
    const second = await run({ text: "Second fixture input", resumeCursor: session.sessionId });
    expect(second).toContainEqual(expect.objectContaining({ type: "session.started", sessionId: session.sessionId }));
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain("First fixture input");
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain("Second fixture input");
  } finally {
    await instance?.dispose();
    await new Promise<void>(accept => provider.close(() => accept()));
    rmSync(root, { recursive: true, force: true });
  }
}, 100_000);
