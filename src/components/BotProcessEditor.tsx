import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import type { BotDesign, BotProcessRun } from "../../shared/bot-design";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { designButton, designInput } from "./BotDesignSkills";

const statusKeys = {
  pending: "design.pending",
  running: "design.running",
  completed: "design.completed",
  failed: "design.failed",
  cancelled: "design.cancelled",
} satisfies Record<string, LocaleKey>;

export function BotProcessEditor({
  steps,
  onChange,
  run,
}: {
  steps: BotDesign["steps"];
  onChange: (steps: BotDesign["steps"]) => void;
  run?: BotProcessRun;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0];
  const index = steps.findIndex((step) => step.id === selected?.id);
  const result = run?.steps.find((step) => step.id === selected?.id);
  const update = (patch: { title?: string; instruction?: string }) =>
    onChange(
      steps.map((step) =>
        step.id === selected?.id ? { ...step, ...patch } : step,
      ),
    );
  const move = (id: string, target: number) => {
    const from = steps.findIndex((step) => step.id === id);
    if (from < 0 || target < 0 || target >= steps.length) return;
    const reordered = [...steps];
    reordered.splice(target, 0, reordered.splice(from, 1)[0]!);
    onChange(reordered);
    setSelectedId(id);
  };
  return (
    <section aria-labelledby="design-steps-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="design-steps-title" className="text-[15px] font-semibold">
          {t("design.steps")}
        </h3>
        <button
          type="button"
          className={`${designButton} inline-flex items-center gap-1`}
          disabled={steps.length >= 24}
          onClick={() => {
            const step = { id: crypto.randomUUID(), title: "", instruction: "" };
            onChange([...steps, step]);
            setSelectedId(step.id);
          }}
        >
          <Plus size={14} />
          {t("design.addStep")}
        </button>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-ink-secondary">
        {t("design.flowHint")}
      </p>
      {!selected ? (
        <p className="mt-3 rounded-xl bg-inset p-4 text-[13px] text-ink-secondary">
          {t("design.emptySteps")}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-4 rounded-xl bg-inset p-3">
          <div className="min-w-0 basis-52 grow">
            <p className="mb-2 text-[12px] font-medium text-ink-secondary">
              {t("design.flow")}
            </p>
            <ol aria-label={t("design.flow")}>
              {steps.map((step, stepIndex) => {
                const status = run?.steps.find(
                  (entry) => entry.id === step.id,
                )?.status;
                return (
                  <li key={step.id} data-process-step={step.id}>
                    {stepIndex > 0 && (
                      <div
                        className="flex h-9 justify-center text-ink-secondary"
                        aria-hidden="true"
                        data-process-connection
                      >
                        <svg width="20" height="36" viewBox="0 0 20 36" fill="none">
                          <path
                            d="M10 0V31M4 25L10 31L16 25"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    )}
                    <div
                      className={`flex items-stretch rounded-xl border ${dropTarget === step.id ? "bg-control" : "bg-card"} ${selected.id === step.id || dropTarget === step.id ? "border-accent" : "border-hairline/40"} ${dragged === step.id ? "opacity-60" : ""}`}
                    >
                      <button
                        type="button"
                        data-process-drag
                        className="flex w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-ink-secondary focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
                        aria-label={t("design.dragStep", { number: stepIndex + 1 })}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setDragged(step.id);
                        }}
                        onPointerMove={(event) => {
                          if (!dragged) return;
                          const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-process-step]");
                          setDropTarget(hit?.getAttribute("data-process-step") ?? null);
                        }}
                        onPointerUp={(event) => {
                          if (!dragged) return;
                          const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-process-step]");
                          const target = steps.findIndex((entry) => entry.id === hit?.getAttribute("data-process-step"));
                          move(step.id, target);
                          setDragged(null);
                          setDropTarget(null);
                        }}
                        onLostPointerCapture={() => {
                          setDragged(null);
                          setDropTarget(null);
                        }}
                      >
                        <GripVertical size={14} />
                      </button>
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded-xl p-3 text-left focus-visible:outline-2 focus-visible:outline-accent hover:bg-control"
                        aria-pressed={selected.id === step.id}
                        aria-current={status === "running" ? "step" : undefined}
                        aria-label={t("design.selectStep", {
                          number: stepIndex + 1,
                          title: step.title || t("design.stepTitlePlaceholder"),
                        })}
                        onClick={() => setSelectedId(step.id)}
                      >
                        <span className="flex items-center gap-2 text-[13px] font-medium">
                          <span className="shrink-0 text-ink-secondary tabular-nums">
                            {stepIndex + 1}.
                          </span>
                          <span className="min-w-0 break-words">
                            {step.title || t("design.stepTitlePlaceholder")}
                          </span>
                          {status === "running" && (
                            <Loader2 size={14} className="ml-auto shrink-0 animate-spin text-accent motion-reduce:animate-none" />
                          )}
                          {status === "completed" && (
                            <Check size={14} className="ml-auto shrink-0 text-success" />
                          )}
                        </span>
                        <span className="mt-1 block line-clamp-2 break-words text-[12px] leading-5 text-ink-secondary">
                          {step.instruction || t("design.stepInstructionPlaceholder")}
                        </span>
                        {status && (
                          <span className={`mt-2 block text-[12px] ${status === "failed" ? "text-danger" : status === "running" ? "text-accent" : "text-ink-secondary"}`}>
                            {t(statusKeys[status])}
                          </span>
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="min-w-0 basis-64 grow-[2] space-y-3 rounded-xl bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[13px] font-semibold">{t("design.details")}</h4>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={designButton}
                  disabled={index === 0}
                  aria-label={t("design.moveUp", { number: index + 1 })}
                  onClick={() => move(selected.id, index - 1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className={designButton}
                  disabled={index === steps.length - 1}
                  aria-label={t("design.moveDown", { number: index + 1 })}
                  onClick={() => move(selected.id, index + 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className={designButton}
                  aria-label={t("design.removeStep", { number: index + 1 })}
                  onClick={() => {
                    onChange(steps.filter((step) => step.id !== selected.id));
                    setSelectedId(steps[index + 1]?.id ?? steps[index - 1]?.id ?? "");
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <label className="block text-[12px] font-medium">
              {t("design.stepTitle", { number: index + 1 })}
              <input
                className={`${designInput} mt-1`}
                value={selected.title}
                maxLength={160}
                placeholder={t("design.stepTitlePlaceholder")}
                onChange={(event) => update({ title: event.target.value })}
              />
            </label>
            <label className="block text-[12px] font-medium">
              {t("design.stepInstruction", { number: index + 1 })}
              <textarea
                className={`${designInput} mt-1`}
                rows={5}
                value={selected.instruction}
                maxLength={8000}
                placeholder={t("design.stepInstructionPlaceholder")}
                onChange={(event) => update({ instruction: event.target.value })}
              />
            </label>
            {result && run && (
              <div className="border-t border-hairline/40 pt-3 text-[12px]">
                <p className="flex flex-wrap justify-between gap-2 text-ink-secondary">
                  <span>{t("design.history")}</span>
                  <span>
                    {new Date(run.startedAt).toLocaleString()} · {t(statusKeys[result.status])}
                  </span>
                </p>
                {(result.output || result.error) && (
                  <div className="mt-3">
                    <p className="font-medium">{t(result.error ? "design.error" : "design.output")}</p>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">{result.error ?? result.output}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
