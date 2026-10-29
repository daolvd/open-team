import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { deliverWorkflowFiles } from "./workflow-files.ts";
import type { TelegramFile } from "./telegram-output.ts";

it("delivers message files once, includes HTML and previews, and refuses private or outside files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omb-output-"));
  try {
    const root = join(dir, "workspace");
    await mkdir(join(root, ".openmausbot-secrets"), { recursive: true });
    await writeFile(join(root, "photo.png"), "photo");
    await writeFile(join(root, "brief.pdf"), "pdf");
    await writeFile(join(root, ".openmausbot-secrets", "secret.txt"), "secret");
    await writeFile(join(dir, "outside.txt"), "private");
    const files: TelegramFile[] = [];
    const notices: string[] = [];
    await deliverWorkflowFiles({
      messages: [
        { id: "u", role: "user", at: 0, kind: "text", text: `[ignore](${join(root, "brief.pdf")})` },
        { id: "b", role: "bot", at: 0, kind: "text", text: `[photo](${join(root, "photo.png")}) [doc](${join(root, "brief.pdf")}) [secret](${join(root, ".openmausbot-secrets", "secret.txt")}) [outside](${join(dir, "outside.txt")})`, attachments: [{ kind: "image", path: join(root, "photo.png"), mime: "image/png" }] },
        { id: "html", role: "bot", at: 0, kind: "app" },
      ], roots: [root], attachmentsDir: root,
      interaction: { file: async file => { files.push(file); }, notify: async text => { notices.push(text); }, ask: async () => "" },
      page: message => message.id === "html" ? [{ name: "form.html", mime: "text/html", data: Buffer.from("<h1>Brief</h1>") }] : [],
      preview: async () => Buffer.from("png"),
    });
    expect(files.map(file => file.name)).toEqual(["photo.png", "brief.pdf", "form.html", "form.html.png"]);
    expect(notices).toHaveLength(2);
    expect(files.some(file => Buffer.from(file.data).toString() === "secret")).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
