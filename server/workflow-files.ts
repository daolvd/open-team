import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Message } from "./store.ts";
import { MESSAGE_FILE_MAX_BYTES, messageFileTargets, openMessageFile } from "./message-file.ts";
import type { TelegramFile, WorkflowInteraction } from "./telegram-output.ts";

export async function deliverWorkflowFiles(deps: {
  messages: Message[];
  roots: string[];
  attachmentsDir: string;
  interaction: WorkflowInteraction;
  page(message: Message): TelegramFile[];
  preview?(html: string): Promise<Uint8Array>;
}): Promise<void> {
  const delivered = new Set<string>();
  const send = async (file: TelegramFile) => {
    if (file.data.byteLength > MESSAGE_FILE_MAX_BYTES) {
      await deps.interaction.notify(`Cannot attach ${file.name}: above the 25 MB file limit. Open it in the app.`);
      return;
    }
    const key = createHash("sha256").update(file.data).digest("hex");
    if (delivered.has(key)) return;
    delivered.add(key);
    await deps.interaction.file(file);
    if (file.mime.split(";", 1)[0] === "text/html" && deps.preview) {
      try {
        await deps.interaction.file({ name: `${file.name}.png`, mime: "image/png", data: await deps.preview(Buffer.from(file.data).toString("utf8")) });
      } catch { await deps.interaction.notify(`HTML preview unavailable; open the attached ${file.name}.`); }
    }
  };
  for (const message of deps.messages) {
    if (message.role !== "bot") continue;
    for (const file of deps.page(message)) await send(file);
    const targets = new Set([...(message.attachments ?? []).map(file => file.path), ...messageFileTargets(message.text ?? "")]);
    for (let href of targets) {
      if (href.startsWith("/api/attachments/")) {
        const name = href.slice("/api/attachments/".length);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) continue;
        href = join(deps.attachmentsDir, name);
      }
      try {
        const opened = await openMessageFile(href, deps.roots);
        try { await send({ name: opened.name, mime: /\.html?$/.test(extname(opened.name).toLowerCase()) ? "text/html" : opened.mime, data: await opened.handle.readFile() }); }
        finally { await opened.handle.close(); }
      } catch {
        await deps.interaction.notify(`Cannot attach ${basename(href)}: missing, outside this conversation, or above the 25 MB file limit. The original link remains in the app.`);
      }
    }
    if (message.publishedPage?.state === "live") await deps.interaction.notify(`${message.publishedPage.title}\n${message.publishedPage.url}`);
  }
}
