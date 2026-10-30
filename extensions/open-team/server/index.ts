import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Owner-editable open-team.json, read at startup from the workspace data directory. */
export const openTeamSchema = z.object({
  name: z.string().trim().min(1).max(80).default("Open Team"),
  features: z.object({
    whitelabel: z.boolean().default(true),
    budgets: z.boolean().default(true),
    billing: z.boolean().default(true),
  }).strict().default({ whitelabel: true, budgets: true, billing: true }),
}).strict();

export function configureOpenTeam(dataDir: string, file = join(dataDir, "open-team.json")) {
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = openTeamSchema.safeParse(raw);
  if (!result.success) throw new Error(`${file}: ${result.error.message}`);
  return {
    name: result.data.name,
    features: Object.entries(result.data.features).filter(([, enabled]) => enabled).map(([name]) => name).sort(),
  };
}
