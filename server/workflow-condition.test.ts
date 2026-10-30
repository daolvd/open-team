import { expect, it } from "vitest";
import { readWorkflowDecision } from "./workflow-condition.ts";

it.each([true, false])("reads an explicit boolean routing decision (%s)", matched => {
  const json = JSON.stringify({ matched, reason: "Yêu cầu về thiết kế" });
  expect(readWorkflowDecision(json)).toEqual({ matched, reason: "Yêu cầu về thiết kế" });
  expect(readWorkflowDecision(`\n\`\`\`json\n${json}\n\`\`\`\n`)).toEqual({ matched, reason: "Yêu cầu về thiết kế" });
});

it.each(['{"matched":"false","reason":"No"}', '{"matched":true}', '{"matched":false,"reason":" "}', "yes", 'A decision: {"matched":true,"reason":"Yes"}'])("rejects ambiguous decisions: %s", text => {
  expect(() => readWorkflowDecision(text)).toThrow(/Invalid routing decision/);
});
