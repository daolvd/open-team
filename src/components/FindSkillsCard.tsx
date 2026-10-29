import { Search } from "lucide-react";
import { t } from "@/lib/i18n";

export const FIND_SKILLS_SOURCE = "https://skills.sh/vercel-labs/skills/find-skills";

export function FindSkillsCard({ installed, busy, onInstall }: {
  installed: boolean;
  busy: boolean;
  onInstall(source: string): void;
}) {
  return (
    <section className="mt-3 rounded-xl border border-hairline/40 bg-inset p-3" aria-label={t("skills.find.title")}>
      <div className="flex flex-wrap items-center gap-2">
        <Search size={15} aria-hidden="true" className="text-ink-secondary" />
        <h3 className="min-w-0 flex-1 text-[14px] font-medium text-ink">{t("skills.find.title")}</h3>
        <a href="https://skills.sh" target="_blank" rel="noopener noreferrer" className="rounded-lg px-2 py-2 text-[13px] text-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">{t("skills.find.browse")}</a>
        <button type="button" disabled={busy || installed} onClick={() => onInstall(FIND_SKILLS_SOURCE)}
          className="rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent">
          {t(installed ? "skills.find.installed" : "skills.find.install")}
        </button>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-ink-secondary">{t("skills.find.hint")}</p>
    </section>
  );
}
