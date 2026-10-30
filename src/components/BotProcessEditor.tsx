import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GitBranch, Maximize2, Plus, Trash2, X } from "lucide-react";
import { botProcessWorkflow, type BotDesign, type BotProcessRun, type BotProcessConsultant } from "../../shared/bot-design";
import { validateWorkflow } from "../../shared/workflow";
import { t } from "@/lib/i18n";
import { designButton, designInput } from "./BotDesignSkills";
import { arrangeProcess, BotProcessCanvas, processStatusKeys } from "./BotProcessCanvas";

function ProcessDialog({ children, footer, onClose }: { children: ReactNode; footer: ReactNode; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return createPortal(
    <dialog ref={dialog} aria-labelledby="process-editor-title"
      className="fixed inset-0 m-auto h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none overflow-hidden rounded-2xl bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/50"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline/40 px-4 py-3">
          <h2 id="process-editor-title" className="text-[18px] font-semibold">{t("design.editorTitle")}</h2>
          <button type="button" aria-label={t("design.closeEditor")} className="rounded-lg p-2 text-ink-secondary hover:bg-control focus-visible:outline-2 focus-visible:outline-accent" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="min-h-0 flex-1 p-4">{children}</div>
        <footer className="shrink-0 border-t border-hairline/40 p-3">{footer}</footer>
      </div>
    </dialog>, document.body,
  );
}

export function BotProcessEditor({ design, onChange, run, saveControls, consultants = [] }: {
  design: BotDesign;
  consultants?: BotProcessConsultant[];
  onChange: (design: BotDesign) => void;
  run?: BotProcessRun;
  saveControls: ReactNode;
}) {
  const { steps } = design;
  const { edges } = botProcessWorkflow(design);
  const [expanded, setExpanded] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  useEffect(() => {
    if (wasExpanded.current && !expanded) openButton.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);
  const [selectedId, setSelectedId] = useState("");
  const [edgeIndex, setEdgeIndex] = useState<number | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0];
  const index = steps.findIndex((step) => step.id === selected?.id);
  const result = run?.steps.find((step) => step.id === selected?.id);
  const edge = edgeIndex === null ? undefined : edges[edgeIndex];
  const update = (patch: Partial<BotDesign["steps"][number]>) => onChange({ ...design, steps: steps.map((step) => step.id === selected?.id ? { ...step, ...patch } : step) });
  const connect = (from: string, to: string) => {
    const next = { ...design, edges: [...edges, { from, to }] };
    try {
      validateWorkflow(botProcessWorkflow(next));
      onChange(next);
      setError("");
      setConnecting(null);
    } catch { setError(t("design.invalidConnection")); }
  };
  const addStep = () => {
    const step = { id: crypto.randomUUID(), title: "", instruction: "" };
    onChange({ ...design, steps: [...steps, step], edges: steps.length ? [...edges, { from: steps.at(-1)!.id, to: step.id }] : [] });
    setSelectedId(step.id); setEdgeIndex(null);
  };
  const addParallelExample = () => {
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    const next = { ...design, steps: ids.map((id, i) => ({ id, title: t((["design.exampleStart", "design.exampleLeft", "design.exampleRight", "design.exampleJoin"] as const)[i]!), instruction: t((["design.exampleStartInstruction", "design.exampleLeftInstruction", "design.exampleRightInstruction", "design.exampleJoinInstruction"] as const)[i]!) })), edges: [{ from: ids[0]!, to: ids[1]! }, { from: ids[0]!, to: ids[2]! }, { from: ids[1]!, to: ids[3]! }, { from: ids[2]!, to: ids[3]! }] };
    onChange({ ...next, steps: arrangeProcess(next) });
    setSelectedId(ids[0]!); setEdgeIndex(null);
  };
  const editor = <section aria-labelledby="design-steps-title" className={`min-w-0 ${expanded ? "flex h-full min-h-0 flex-col" : ""}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="design-steps-title" className="text-[15px] font-semibold">{t("design.steps")}</h3>
      <div className="flex flex-wrap gap-2">
        {!expanded && <button ref={openButton} type="button" className={`${designButton} inline-flex items-center gap-2`} onClick={() => setExpanded(true)}><Maximize2 size={14} />{t("design.openEditor")}</button>}
        {steps.length > 0 && <button type="button" className={designButton} onClick={() => onChange({ ...design, steps: arrangeProcess(design) })}>{t("design.arrange")}</button>}
        <button type="button" className={`${designButton} inline-flex items-center gap-1`} disabled={steps.length >= 24} onClick={addStep}><Plus size={14} />{t("design.addStep")}</button>
      </div>
    </div>
    <div className="relative mt-2">
      <p className={`text-[12px] leading-5 text-ink-secondary ${connecting ? "invisible" : ""}`}>{t("design.flowHint")}</p>
      {connecting && <div role="status" className="absolute inset-0 flex items-center justify-between gap-2 text-[12px] text-accent-text"><span>{t("design.connectHint")}</span><button type="button" className={`${designButton} shrink-0`} onClick={() => setConnecting(null)}>{t("design.cancelConnection")}</button></div>}
    </div>
    {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    <div className={`mt-3 min-w-0 ${expanded ? "grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden" : "space-y-3"}`}>
      <BotProcessCanvas consultants={consultants} expanded={expanded} onOpen={expanded ? undefined : () => setExpanded(true)} design={design} selectedId={selected?.id ?? ""} connecting={connecting} onSelect={(id) => { setSelectedId(id); setEdgeIndex(null); setExpanded(true); }} onConnect={connect} onConnecting={setConnecting} onChange={onChange} onEdge={(index) => { setEdgeIndex(index); setExpanded(true); }} run={run} empty={
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 px-5 py-8 text-center">
          <button type="button" className="inline-flex min-h-20 items-center gap-2 rounded-xl border border-dashed border-accent bg-card px-6 text-[14px] font-medium text-accent-text hover:bg-control focus-visible:outline-2 focus-visible:outline-accent" onClick={addStep}><Plus size={18} />{t("design.addFirstStep")}</button>
          <p className="max-w-sm text-[12px] leading-5 text-ink-secondary">{t("design.emptySteps")}</p>
          <button type="button" className={`${designButton} inline-flex items-center gap-2`} onClick={addParallelExample}><GitBranch size={15} />{t("design.parallelExample")}</button>
        </div>
      } />
      {selected && <aside className={expanded ? "min-h-0 min-w-0 lg:overflow-y-auto" : ""}>
      {edge ? <div className="space-y-3 rounded-xl border border-hairline/40 bg-card p-3">
        <div className="flex items-center justify-between gap-2"><h4 className="text-[13px] font-semibold">{steps.find((step) => step.id === edge.from)?.title} → {steps.find((step) => step.id === edge.to)?.title}</h4><button type="button" className={designButton} onClick={() => { onChange({ ...design, edges: edges.filter((_, i) => i !== edgeIndex) }); setEdgeIndex(null); }}>{t("design.removeConnection")}</button></div>
        <label className="block text-[12px] font-medium">{t("design.condition")}<input className={`${designInput} mt-1`} value={edge.contains ?? ""} maxLength={1000} placeholder={t("design.always")} onChange={(event) => { const contains = event.target.value; onChange({ ...design, edges: edges.map((entry, i) => i === edgeIndex ? { from: entry.from, to: entry.to, ...(contains.trim() ? { contains } : {}) } : entry) }); }} /></label>
        <p className="text-[12px] leading-5 text-ink-secondary">{t("design.conditionHint")}</p>
      </div> : <div className="min-w-0 space-y-3 rounded-xl border border-hairline/40 bg-card p-3">
        <div className="flex items-center justify-between gap-2"><h4 className="text-[13px] font-semibold">{t("design.details")}</h4><button type="button" className={designButton} aria-label={t("design.removeStep", { number: index + 1 })} onClick={() => {
          onChange({ ...design, steps: steps.filter((step) => step.id !== selected.id), edges: edges.filter((link) => link.from !== selected.id && link.to !== selected.id) });
          setSelectedId(steps[index + 1]?.id ?? steps[index - 1]?.id ?? "");
          if (connecting === selected.id) setConnecting(null);
        }}><Trash2 size={14} /></button></div>
        <label className="block text-[12px] font-medium">{t("design.stepTitle", { number: index + 1 })}<input className={`${designInput} mt-1`} value={selected.title} maxLength={160} placeholder={t("design.stepTitlePlaceholder")} onChange={(event) => update({ title: event.target.value })} /></label>
        <label className="block text-[12px] font-medium">{t("design.stepHandler")}<select className={`${designInput} mt-1`} value={selected.askBotId ?? ""} onChange={(event) => update({ askBotId: event.target.value || undefined })}>
          <option value="">{t("design.executeStep")}</option>
          <optgroup label={t("design.askBot")}>
            {consultants.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
            {selected.askBotId && !consultants.some((bot) => bot.id === selected.askBotId) && <option value={selected.askBotId}>{t("design.botUnavailable", { id: selected.askBotId })}</option>}
          </optgroup>
        </select></label>
        <p className="text-[12px] leading-5 text-ink-secondary">{t(selected.askBotId ? "design.askHint" : "design.askSetupHint")}</p>
        <label className="block text-[12px] font-medium">{selected.askBotId ? t("design.question") : t("design.stepInstruction", { number: index + 1 })}<textarea className={`${designInput} mt-1`} rows={5} value={selected.instruction} maxLength={8000} placeholder={t("design.stepInstructionPlaceholder")} onChange={(event) => update({ instruction: event.target.value })} /></label>
        {result && run && <div className="border-t border-hairline/40 pt-3 text-[12px]"><p className="flex flex-wrap justify-between gap-2 text-ink-secondary"><span>{selected.askBotId ? t("design.askingBot", { name: consultants.find((bot) => bot.id === selected.askBotId)?.name ?? selected.askBotId }) : t("design.history")}</span><span>{new Date(run.startedAt).toLocaleString()} · {t(processStatusKeys[result.status])}</span></p>{(result.output || result.error) && <div className="mt-3"><p className="font-medium">{t(result.error ? "design.error" : "design.output")}</p><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">{result.error ?? result.output}</pre></div>}</div>}
      </div>}
      </aside>}
    </div>
  </section>;
  return expanded ? <ProcessDialog footer={saveControls} onClose={() => { setExpanded(false); setConnecting(null); }}>{editor}</ProcessDialog> : editor;
}
