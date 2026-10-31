import { expect, it } from "vitest";
import { readWorkflowDecision, readWorkflowSelection } from "./workflow-condition.ts";

it("reads the chosen steps, without duplicates, from a fenced reply", () => {
  expect(readWorkflowSelection('```json\n{"selected":["a","a","b"],"reason":"Thiết kế"}\n```', ["a", "b", "c"]))
    .toEqual({ selected: ["a", "b"], reason: "Thiết kế" });
  expect(readWorkflowSelection('{"selected":[],"reason":"Không bước nào"}', ["a"])).toEqual({ selected: [], reason: "Không bước nào" });
});

it.each(['{"selected":"a","reason":"x"}', '{"selected":["a"]}', '{"selected":["a"],"reason":" "}', "a"])("rejects an unusable selection: %s", text => {
  expect(() => readWorkflowSelection(text, ["a"])).toThrow(/Invalid request routing/);
});

it("rejects steps that were not candidates", () => {
  expect(() => readWorkflowSelection('{"selected":["x"],"reason":"x"}', ["a"])).toThrow(/unknown steps: x/);
});

it.each([true, false])("reads an explicit boolean routing decision (%s)", matched => {
  const json = JSON.stringify({ matched, reason: "Yêu cầu về thiết kế" });
  expect(readWorkflowDecision(json)).toEqual({ matched, reason: "Yêu cầu về thiết kế" });
  expect(readWorkflowDecision(`\n\`\`\`json\n${json}\n\`\`\`\n`)).toEqual({ matched, reason: "Yêu cầu về thiết kế" });
});

it.each(['{"matched":"false","reason":"No"}', '{"matched":true}', '{"matched":false,"reason":" "}', "yes", 'A decision: {"matched":true,"reason":"Yes"}'])("rejects ambiguous decisions: %s", text => {
  expect(() => readWorkflowDecision(text)).toThrow(/Invalid routing decision/);
});
