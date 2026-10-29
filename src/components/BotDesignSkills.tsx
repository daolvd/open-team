import { useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { api, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { Switch } from "./SettingsPrimitives";
import {
  SkillReviewDialog,
  useManagedSkills,
} from "./bot-settings/SkillsSection";

export const designButton =
  "rounded-lg border border-hairline/40 bg-control px-3 py-2 text-[13px] font-medium text-ink hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
export const designInput =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus-visible:outline-2 focus-visible:outline-accent";

type DroppedFile = { path: string; content: string };
async function readFiles(files: File[]): Promise<DroppedFile[]> {
  if (!files.length || files.length > 100)
    throw new Error(t("design.dropLimit"));
  return Promise.all(
    files.map(async (file) => {
      if (file.size > 200000 || /\.(zip|gz|exe|png|jpg|pdf)$/i.test(file.name))
        throw new Error(t("design.dropLimit"));
      const content = await file.text();
      if (content.includes("\0")) throw new Error(t("design.dropLimit"));
      return { path: file.name, content };
    }),
  );
}

async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  let visited = 0;
  async function visit(entry: FileSystemEntry): Promise<void> {
    if (++visited > 200) throw new Error(t("design.dropLimit"));
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push(file);
      if (files.length > 100) throw new Error(t("design.dropLimit"));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child);
      }
    }
  }
  const entries = Array.from(transfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) return Array.from(transfer.files);
  for (const entry of entries) await visit(entry);
  return files;
}

export function BotDesignSkills({ bot }: { bot: Bot }) {
  const skills = useManagedSkills(bot);
  const input = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const [source, setSource] = useState("");
  const [notice, setNotice] = useState("");
  const [over, setOver] = useState(false);
  const install = async (files?: File[]) => {
    if (importing.current || skills.working) return;
    importing.current = true;
    skills.setWorking("install");
    skills.setError("");
    setNotice("");
    try {
      let warnings: string[] = [];
      if (files) {
        await api(`/api/bots/${bot.id}/skill-files`, {
          method: "POST",
          body: JSON.stringify({ files: await readFiles(files) }),
        });
      } else {
        const result = await api<{ errors?: string[] }>(
          `/api/bots/${bot.id}/skills`,
          {
            method: "POST",
            body: JSON.stringify({
              source: source.replace(/^install\s+/i, "").trim(),
            }),
          },
        );
        warnings = result.errors ?? [];
        setSource("");
      }
      await skills.refresh();
      setNotice([t("design.installed"), ...warnings].join(" · "));
    } catch (cause) {
      skills.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      importing.current = false;
      skills.setWorking("");
      if (input.current) input.current.value = "";
    }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const transfer = event.dataTransfer;
    void droppedFiles(transfer)
      .then((files) => install(files))
      .catch((cause) =>
        skills.setError(cause instanceof Error ? cause.message : String(cause)),
      );
  };
  return (
    <section
      aria-labelledby="design-skills-title"
      className="space-y-3 border-t border-hairline/40 pt-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="design-skills-title" className="text-[15px] font-semibold">
          {t("design.skills")}
        </h3>
        <button
          type="button"
          className={designButton}
          disabled={skills.loading || Boolean(skills.working)}
          onClick={() => void skills.disableAll()}
        >
          {t("skills.disableAll")}
        </button>
      </div>
      <p className="text-[12px] leading-5 text-ink-secondary">
        {t("skills.disableAllHint")}
      </p>
      <button
        type="button"
        className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-[13px] focus-visible:outline-2 focus-visible:outline-accent ${over ? "border-accent bg-accent/10" : "border-hairline/50 bg-inset"}`}
        onClick={() => input.current?.click()}
        disabled={Boolean(skills.working)}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <Upload size={16} aria-hidden="true" /> {t("design.drop")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".md"
        multiple
        hidden
        onChange={(event) => void install(Array.from(event.target.files ?? []))}
      />
      <p className="text-[12px] text-ink-secondary">{t("design.dropHint")}</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void install();
        }}
      >
        <input
          aria-label={t("design.skillSource")}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className={`${designInput} min-w-0 flex-1 basis-44`}
          placeholder="install https://github.com/owner/repo"
          maxLength={2000}
        />
        <button
          className={designButton}
          disabled={!source.trim() || Boolean(skills.working)}
        >
          {t("design.install")}
        </button>
      </form>
      {notice && (
        <p role="status" className="text-[12px] text-ink-secondary">
          {notice}
        </p>
      )}
      {skills.error && (
        <p role="alert" className="text-[13px] text-danger">
          {skills.error}
        </p>
      )}
      {skills.loading ? (
        <p role="status">{t("design.loading")}</p>
      ) : !skills.skills.length ? (
        <p className="text-[13px] text-ink-secondary">{t("design.noSkills")}</p>
      ) : (
        <ul className="divide-y divide-hairline/30">
          {skills.skills.map((skill) => (
            <li key={skill.name} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="break-words text-[13px] font-medium">
                  {skill.name}
                </div>
                <div className="mt-0.5 break-words text-[12px] text-ink-secondary">
                  {skill.description}
                </div>
                <div className="mt-1 text-[11px] text-ink-secondary">
                  {skill.origin ?? "private"}
                </div>
              </div>
              <Switch
                checked={skill.enabled}
                aria-label={skill.name}
                disabled={Boolean(skills.working)}
                onClick={() => void skills.toggle(skill)}
              />
            </li>
          ))}
        </ul>
      )}
      {skills.reviewing && (
        <SkillReviewDialog
          skill={skills.reviewing.skill}
          text={skills.reviewing.text}
          working={Boolean(skills.working)}
          error={skills.error}
          onCancel={() => skills.setReviewing(null)}
          onEnable={() => void skills.enableReviewed()}
        />
      )}
    </section>
  );
}
