import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { Switch } from "../SettingsPrimitives";
import type { BotPatch } from "./useBotSettingsDerived";

export function ComputerUseControl({ bot, patch }: { bot: Bot; patch: (patch: BotPatch) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-ink">{t("botAccess.computerUse.title")}</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">{t("botAccess.computerUse.description")}</div>
      </div>
      <Switch
        checked={bot.computer !== "off"}
        aria-label={t("botAccess.computerUse.title")}
        disabled={bot.busy}
        onClick={() => patch({ computer: bot.computer === "off" ? null : "off" })}
      />
    </div>
  );
}
