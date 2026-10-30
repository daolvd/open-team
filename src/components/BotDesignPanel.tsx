import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { Switch } from "./SettingsPrimitives";
import { BotDesignSkills, designButton, designInput } from "./BotDesignSkills";
import { useBotDesign } from "./bot-design-state";
import { BotProcessEditor } from "./BotProcessEditor";

const statusKeys = {
  pending: "design.pending",
  running: "design.running",
  completed: "design.completed",
  failed: "design.failed",
  cancelled: "design.cancelled",
  skipped: "design.skipped",
} satisfies Record<string, LocaleKey>;

export function BotDesignPanel({ bot }: { bot: Bot }) {
  const model = useBotDesign(bot.id);
  const { draft, setDraft, snapshot, working } = model;
  const [tab, setTab] = useState<"process" | "skills">("process");
  const [task, setTask] = useState("");
  const [message, setMessage] = useState("");
  const [selectedRun, setSelectedRun] = useState("");
  const active = snapshot?.runs.find((run) => run.status === "running");
  const run =
    snapshot?.runs.find((entry) => entry.id === selectedRun) ??
    snapshot?.runs[0];
  return (
    <div className="space-y-5 p-4 text-ink" data-testid="bot-design">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[18px] font-semibold">
            {t("design.title", { name: bot.name })}
          </h2>
          <span className="text-[12px] text-ink-secondary">
            {model.dirty ? t("design.unsaved") : t("design.saved")}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-ink-secondary">
          {t("design.intro")}
        </p>
      </header>
      <div
        className="flex gap-2"
        role="group"
        aria-label={t("design.sections")}
      >
        {(["process", "skills"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={`${designButton} ${tab === value ? "!bg-ink !text-app" : ""}`}
          >
            {t(value === "process" ? "design.process" : "design.skills")}
          </button>
        ))}
      </div>
      {tab === "skills" ? (
        <BotDesignSkills bot={bot} />
      ) : (
        <>
          {!snapshot ? (
            <p role="status">{t("design.loading")}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-inset p-3">
                <div>
                  <div className="text-[13px] font-medium">
                    {t("design.enable")}
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-ink-secondary">
                    {t("design.enableHint")}
                  </p>
                </div>
                <Switch
                  checked={draft.enabled}
                  aria-label={t("design.enable")}
                  onClick={() =>
                    setDraft({ ...draft, enabled: !draft.enabled })
                  }
                />
              </div>
              <label className="block text-[13px] font-medium">
                {t("design.identity")}
                <textarea
                  className={`${designInput} mt-2`}
                  rows={2}
                  value={draft.identity}
                  maxLength={8000}
                  onChange={(event) =>
                    setDraft({ ...draft, identity: event.target.value })
                  }
                  placeholder={t("design.identityPlaceholder")}
                />
              </label>
              <label className="block text-[13px] font-medium">
                {t("design.method")}
                <textarea
                  className={`${designInput} mt-2`}
                  rows={2}
                  value={draft.method}
                  maxLength={16000}
                  onChange={(event) =>
                    setDraft({ ...draft, method: event.target.value })
                  }
                  placeholder={t("design.methodPlaceholder")}
                />
              </label>
              <BotProcessEditor
                design={draft}
                onChange={setDraft}
                run={
                  JSON.stringify(run?.design) === JSON.stringify(draft)
                    ? run
                    : undefined
                }
              />
              <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-xl border border-hairline/40 bg-card p-3">
                <span className="text-[12px] text-ink-secondary">
                  {model.dirty
                    ? t("design.unsavedHint")
                    : t("design.savedHint")}
                </span>
                <button
                  type="button"
                  className={`${designButton} shrink-0 !bg-ink !text-app`}
                  disabled={Boolean(working) || !model.dirty}
                  onClick={() => void model.save()}
                >
                  {working === "save" ? t("design.saving") : t("design.save")}
                </button>
              </div>
              <section
                className="space-y-3 border-t border-hairline/40 pt-5"
                aria-labelledby="design-assistant-title"
              >
                <h3
                  id="design-assistant-title"
                  className="text-[15px] font-semibold"
                >
                  {t("design.assistant")}
                </h3>
                <p className="text-[12px] leading-5 text-ink-secondary">
                  {t("design.assistantHint")}
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void model.propose(message);
                  }}
                  className="space-y-2"
                >
                  <textarea
                    className={designInput}
                    aria-label={t("design.setupMessage")}
                    value={message}
                    maxLength={8000}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={2}
                    placeholder={t("design.setupPlaceholder")}
                  />
                  <button
                    className={designButton}
                    disabled={!message.trim() || Boolean(working)}
                  >
                    {working === "propose"
                      ? t("design.thinking")
                      : t("design.propose")}
                  </button>
                </form>
                {model.proposal && (
                  <div className="space-y-3 rounded-xl bg-inset p-3">
                    <p className="text-[13px] font-medium">
                      {t("design.proposal")}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-[13px]">
                      {model.proposal.identity}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-[12px] text-ink-secondary">
                      {model.proposal.method}
                    </p>
                    <ol className="list-inside list-decimal space-y-1 text-[13px]">
                      {model.proposal.steps.map((step) => (
                        <li key={step.id}>
                          {step.title}
                          <p className="my-1 whitespace-pre-wrap break-words text-[12px] text-ink-secondary">
                            {step.instruction}
                          </p>
                        </li>
                      ))}
                    </ol>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={designButton}
                        onClick={() => {
                          setDraft(model.proposal!);
                          model.setProposal(null);
                        }}
                      >
                        {t("design.useDraft")}
                      </button>
                      <button
                        type="button"
                        className={designButton}
                        onClick={() => model.setProposal(null)}
                      >
                        {t("design.dismiss")}
                      </button>
                    </div>
                  </div>
                )}
              </section>
              <section
                className="space-y-3 border-t border-hairline/40 pt-5"
                aria-labelledby="design-run-title"
              >
                <h3 id="design-run-title" className="text-[15px] font-semibold">
                  {t("design.runTitle")}
                </h3>
                <p className="text-[12px] leading-5 text-ink-secondary">
                  {t("design.runHint")}
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setSelectedRun("");
                    void model.run(task);
                  }}
                  className="space-y-2"
                >
                  <textarea
                    className={designInput}
                    aria-label={t("design.task")}
                    rows={2}
                    maxLength={16000}
                    value={task}
                    onChange={(event) => setTask(event.target.value)}
                    placeholder={t("design.taskPlaceholder")}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={designButton}
                      disabled={
                        Boolean(working) ||
                        Boolean(active) ||
                        model.dirty ||
                        !snapshot.design.enabled ||
                        !snapshot.design.steps.length ||
                        !task.trim()
                      }
                    >
                      {t("design.run")}
                    </button>
                    {active && (
                      <button
                        type="button"
                        className={`${designButton} text-danger`}
                        disabled={Boolean(working)}
                        onClick={() => void model.stop()}
                      >
                        {t("design.stop")}
                      </button>
                    )}
                  </div>
                </form>
                {!!snapshot.runs.length && (
                  <label className="block text-[12px] text-ink-secondary">
                    {t("design.history")}
                    <select
                      className={`${designInput} mt-1`}
                      value={run?.id ?? ""}
                      onChange={(event) => setSelectedRun(event.target.value)}
                    >
                      {snapshot.runs.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {new Date(entry.startedAt).toLocaleString()} ·{" "}
                          {t(statusKeys[entry.status])}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {run ? (
                  <div className="rounded-xl bg-inset p-3">
                    <div
                      role="status"
                      className="mb-3 flex items-center gap-2 text-[13px] font-semibold"
                    >
                      {run.status === "running" && (
                        <Loader2
                          size={14}
                          className="animate-spin motion-reduce:animate-none"
                        />
                      )}
                      {t(statusKeys[run.status])}
                    </div>
                    <p className="mb-4 whitespace-pre-wrap break-words text-[13px]">
                      {run.input}
                    </p>
                    <ol
                      aria-label={t("design.execution")}
                      className="space-y-3"
                    >
                      {run.steps.map((step, index) => (
                        <li
                          key={step.id}
                          className="border-l-2 border-hairline/50 pl-3"
                        >
                          <div className="flex items-center gap-2 text-[13px] font-medium">
                            {step.status === "completed" && (
                              <Check size={14} className="text-success" />
                            )}
                            <span>
                              {index + 1}. {run.design.steps[index]?.title}
                            </span>
                            <span
                              className={`ml-auto text-[11px] ${step.status === "failed" ? "text-danger" : "text-ink-secondary"}`}
                            >
                              {t(statusKeys[step.status])}
                            </span>
                          </div>
                          {step.startedAt && (
                            <p className="mt-1 text-[11px] text-ink-secondary">
                              {new Date(step.startedAt).toLocaleTimeString()}
                              {step.endedAt &&
                                ` · ${((step.endedAt - step.startedAt) / 1000).toFixed(1)}s`}
                            </p>
                          )}
                          {(step.output || step.error) && (
                            <details
                              className="mt-2 text-[12px]"
                              open={step.status === "failed"}
                            >
                              <summary className="cursor-pointer">
                                {step.error
                                  ? t("design.error")
                                  : t("design.output")}
                              </summary>
                              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px]">
                                {step.error ?? step.output}
                              </pre>
                            </details>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className="rounded-xl bg-inset p-4 text-[13px] text-ink-secondary">
                    {t("design.noRuns")}
                  </p>
                )}
              </section>
              <section className="space-y-3 border-t border-hairline/40 pt-5">
                <h3 className="text-[15px] font-semibold">
                  {t(active ? "design.liveActivity" : "design.chatActivity")}
                </h3>
                <p className="text-[12px] leading-5 text-ink-secondary">
                  {t("design.activityHint")}
                </p>
                {snapshot.activity.length ? (
                  <ol className="space-y-2">
                    {snapshot.activity.slice(-12).map((event) => (
                      <li
                        key={event.id}
                        className="rounded-lg bg-inset p-3 text-[12px]"
                      >
                        <div className="flex justify-between gap-2 font-medium">
                          <span className="break-all">
                            {event.tool?.name ?? event.text}
                          </span>
                          <span
                            className={
                              event.tool?.ok === false
                                ? "text-danger"
                                : "text-ink-secondary"
                            }
                          >
                            {event.tool?.ok === undefined
                              ? t("design.running")
                              : event.tool.ok
                                ? t("design.completed")
                                : t("design.failed")}
                          </span>
                        </div>
                        {(event.tool?.input ||
                          event.tool?.output ||
                          event.tool?.summary) && (
                          <details className="mt-2">
                            <summary className="cursor-pointer">
                              {t("design.details")}
                            </summary>
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                              {[
                                event.tool.input,
                                event.tool.summary,
                                event.tool.output,
                              ]
                                .filter(Boolean)
                                .join("\n")}
                            </pre>
                          </details>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[13px] text-ink-secondary">
                    {t("design.noActivity")}
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
      {model.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger/10 p-3 text-[13px] text-danger"
        >
          {model.error}
        </p>
      )}
    </div>
  );
}
