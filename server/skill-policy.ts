import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

const schema = z.object({
  allDisabled: z.boolean(),
  overrides: z.record(z.string(), z.boolean()),
});
const pathFor = (botId: string) =>
  join(DATA_DIR, "skill-state", botId, "policy.json");

export function readSkillPolicy(botId: string): z.infer<typeof schema> {
  try {
    return schema.parse(JSON.parse(readFileSync(pathFor(botId), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { allDisabled: false, overrides: {} };
    throw error;
  }
}

export function skillAllowed(botId: string, name: string): boolean {
  const policy = readSkillPolicy(botId);
  return Object.hasOwn(policy.overrides, name)
    ? policy.overrides[name]!
    : !policy.allDisabled;
}

export function setBotSkillAllowed(
  botId: string,
  name: string,
  enabled: boolean,
): void {
  const policy = readSkillPolicy(botId);
  policy.overrides[name] = enabled;
  mkdirSync(dirname(pathFor(botId)), { recursive: true, mode: 0o700 });
  writeFileAtomic(pathFor(botId), JSON.stringify(policy), { mode: 0o600 });
}

export function disableAllBotSkills(botId: string): void {
  mkdirSync(dirname(pathFor(botId)), { recursive: true, mode: 0o700 });
  writeFileAtomic(
    pathFor(botId),
    JSON.stringify({ allDisabled: true, overrides: {} }),
    { mode: 0o600 },
  );
}
