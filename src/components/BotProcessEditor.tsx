import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GitBranch, Maximize2, Plus, Trash2, X } from "lucide-react";
import { botProcessEdges, botProcessGraph, type BotDesign, type BotDesignEdge, type BotDesignStep, type BotProcessRun, type BotProcessConsultant } from "../../shared/bot-design";
import { validateProcessGraph } from "../../shared/process-run";
import { EFFORT_LEVELS, type EffortLevel } from "../../shared/wire";
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
  const edges = botProcessEdges(design);
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
    for (const edge of [{ from, to }, { from, to, when: "verdict == FAIL", loop: { max: 3 } }]) {
      const next = { ...design, edges: [...edges, edge] };
      try {
        validateProcessGraph(botProcessGraph(next));
        onChange(next);
        setError("");
        setConnecting(null);
        if (edge.loop) setEdgeIndex(next.edges.length - 1);
        return;
      } catch {}
    }
    setError(t("design.invalidConnection"));
  };
  let graphProblem = "";
  try { validateProcessGraph(botProcessGraph(design)); } catch (cause) { graphProblem = cause instanceof Error ? cause.message : String(cause); }
  const incoming = selected ? edges.filter((link) => link.to === selected.id && !link.loop).length : 0;
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
    {(error || graphProblem) && <p role="alert" className="mt-2 text-[12px] text-danger">{error || graphProblem}</p>}
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
        <EdgeFields edge={edge} onChange={(next) => onChange({ ...design, edges: edges.map((entry, i) => i === edgeIndex ? next : entry) })} />
      </div> : <div className="min-w-0 space-y-3 rounded-xl border border-hairline/40 bg-card p-3">
        <div className="flex items-center justify-between gap-2"><h4 className="text-[13px] font-semibold">{t("design.details")}</h4><button type="button" className={designButton} aria-label={t("design.removeStep", { number: index + 1 })} onClick={() => {
          onChange({ ...design, steps: steps.filter((step) => step.id !== selected.id), edges: edges.filter((link) => link.from !== selected.id && link.to !== selected.id) });
          setSelectedId(steps[index + 1]?.id ?? steps[index - 1]?.id ?? "");
          if (connecting === selected.id) setConnecting(null);
        }}><Trash2 size={14} /></button></div>
        <label className="block text-[12px] font-medium">{t("design.stepTitle", { number: index + 1 })}<input className={`${designInput} mt-1`} value={selected.title} maxLength={160} placeholder={t("design.stepTitlePlaceholder")} onChange={(event) => update({ title: event.target.value })} /></label>
        <StepFields step={selected} consultants={consultants} incoming={incoming} update={update} />
        <label className="block text-[12px] font-medium">{selected.askBotId ? t("design.question") : t("design.stepInstruction", { number: index + 1 })}<textarea className={`${designInput} mt-1`} rows={5} value={selected.instruction} maxLength={8000} placeholder={t("design.stepInstructionPlaceholder")} onChange={(event) => update({ instruction: event.target.value })} /></label>
        {result && run && <div className="border-t border-hairline/40 pt-3 text-[12px]"><p className="flex flex-wrap justify-between gap-2 text-ink-secondary"><span>{selected.askBotId ? t("design.askingBot", { name: consultants.find((bot) => bot.id === selected.askBotId)?.name ?? selected.askBotId }) : t("design.history")}</span><span>{new Date(run.startedAt).toLocaleString()} · {t(processStatusKeys[result.status])}</span></p>{(result.output || result.error) && <div className="mt-3"><p className="font-medium">{t(result.error ? "design.error" : "design.output")}</p><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">{result.error ?? result.output}</pre></div>}</div>}
      </div>}
      </aside>}
    </div>
  </section>;
  return expanded ? <ProcessDialog footer={saveControls} onClose={() => { setExpanded(false); setConnecting(null); }}>{editor}</ProcessDialog> : editor;
}

type EdgeKind = "always" | "contains" | "when" | "condition" | "otherwise";
const EDGE_DEFAULTS = { contains: "NEEDS_DECISION", when: "verdict == FAIL", condition: "" } as const;

function EdgeFields({ edge, onChange }: { edge: BotDesignEdge; onChange(edge: BotDesignEdge): void }) {
  const kind: EdgeKind = edge.contains !== undefined ? "contains" : edge.when !== undefined ? "when" : edge.condition !== undefined ? "condition" : edge.otherwise ? "otherwise" : "always";
  const base = { from: edge.from, to: edge.to, ...(edge.loop ? { loop: edge.loop } : {}) };
  const withKind = (next: EdgeKind, value?: string): BotDesignEdge => next === "always" ? { from: edge.from, to: edge.to }
    : next === "otherwise" ? { from: edge.from, to: edge.to, otherwise: true }
      : { ...base, [next]: value ?? (kind === next ? edge[next] : EDGE_DEFAULTS[next]) ?? "" };
  const value = kind === "contains" ? edge.contains : kind === "when" ? edge.when : kind === "condition" ? edge.condition : undefined;
  return <>
    <label className="block text-[12px] font-medium">{t("design.conditionType")}<select className={`${designInput} mt-1`} value={kind} onChange={(event) => onChange(withKind(event.target.value as EdgeKind))}>
      <option value="always">{t("design.conditionAlways")}</option>
      <option value="when">{t("design.conditionWhen")}</option>
      <option value="contains">{t("design.conditionContains")}</option>
      <option value="condition">{t("design.conditionAi")}</option>
      <option value="otherwise">{t("design.conditionOtherwise")}</option>
    </select></label>
    {value !== undefined && <input aria-label={t("design.conditionType")} className={designInput} value={value} maxLength={kind === "when" ? 500 : 2000}
      placeholder={kind === "when" ? t("design.whenPlaceholder") : kind === "condition" ? t("design.aiPlaceholder") : ""} onChange={(event) => onChange(withKind(kind, event.target.value))} />}
    <p className="text-[12px] leading-5 text-ink-secondary">{t(kind === "when" ? "design.whenHint" : "design.conditionHint")}</p>
    {kind !== "otherwise" && <label className="flex items-center gap-2 text-[12px] font-medium"><input type="checkbox" checked={Boolean(edge.loop)}
      onChange={(event) => onChange(event.target.checked ? { ...(kind === "always" ? withKind("when") : edge), loop: { max: 3 } } : withKind(kind, value))} />{t("design.loop")}</label>}
    {edge.loop && <>
      <label className="block text-[12px] font-medium">{t("design.loopMax")}<input type="number" min={1} max={10} className={`${designInput} mt-1`} value={edge.loop.max}
        onChange={(event) => onChange({ ...edge, loop: { max: Math.min(10, Math.max(1, Math.round(Number(event.target.value) || 1))) } })} /></label>
      <p className="text-[12px] leading-5 text-ink-secondary">{t("design.loopHint")}</p>
    </>}
  </>;
}

function StepFields({ step, consultants, incoming, update }: {
  step: BotDesignStep; consultants: BotProcessConsultant[]; incoming: number; update(patch: Partial<BotDesignStep>): void;
}) {
  const handler = step.approval ? "approval" : step.askBotId ? `ask:${step.askBotId}` : step.botId ? `do:${step.botId}` : "";
  const missing = [step.askBotId, step.botId].find((id) => id && !consultants.some((bot) => bot.id === id));
  const setHandler = (value: string) => {
    const [kind, id] = value.split(/:(.*)/s);
    update({ askBotId: kind === "ask" ? id : undefined, botId: kind === "do" ? id : undefined,
      approval: kind === "approval" ? step.approval ?? { timeoutHours: 4, default: "reject" } : undefined,
      ...(kind === "approval" ? { model: undefined, effort: undefined, forEach: undefined, concurrency: undefined } : {}) });
  };
  return <>
    <label className="block text-[12px] font-medium">{t("design.stepHandler")}<select className={`${designInput} mt-1`} value={handler} onChange={(event) => setHandler(event.target.value)}>
      <option value="">{t("design.executeStep")}</option>
      <optgroup label={t("design.teammateDoes")}>{consultants.map((bot) => <option key={bot.id} value={`do:${bot.id}`}>{bot.name}</option>)}</optgroup>
      <optgroup label={t("design.askBot")}>{consultants.map((bot) => <option key={bot.id} value={`ask:${bot.id}`}>{bot.name}</option>)}</optgroup>
      <option value="approval">{t("design.personApproves")}</option>
      {missing && <option value={handler}>{t("design.botUnavailable", { id: missing })}</option>}
    </select></label>
    <p className="text-[12px] leading-5 text-ink-secondary">{t(step.approval ? "design.approvalHint" : step.askBotId ? "design.askHint" : "design.askSetupHint")}</p>
    {step.approval ? <div className="grid grid-cols-2 gap-2">
      <label className="block text-[12px] font-medium">{t("design.approvalTimeout")}<input type="number" min={0.1} max={168} step={0.5} className={`${designInput} mt-1`} value={step.approval.timeoutHours}
        onChange={(event) => update({ approval: { ...step.approval!, timeoutHours: Math.min(168, Math.max(0.1, Number(event.target.value) || 1)) } })} /></label>
      <label className="block text-[12px] font-medium">{t("design.approvalDefault")}<select className={`${designInput} mt-1`} value={step.approval.default}
        onChange={(event) => update({ approval: { ...step.approval!, default: event.target.value as "approve" | "reject" } })}>
        <option value="reject">{t("design.reject")}</option><option value="approve">{t("design.approve")}</option>
      </select></label>
    </div> : <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="block min-w-0 text-[12px] font-medium">{t("design.model")}<input className={`${designInput} mt-1`} value={step.model ?? ""} maxLength={200} placeholder={t("design.modelPlaceholder")} onChange={(event) => update({ model: event.target.value.trim() ? event.target.value : undefined })} /></label>
        <label className="block text-[12px] font-medium">{t("design.effort")}<select className={`${designInput} mt-1`} value={step.effort ?? ""} onChange={(event) => update({ effort: (event.target.value || undefined) as EffortLevel | undefined })}>
          <option value="">{t("design.effortDefault")}</option>{EFFORT_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
        </select></label>
      </div>
      <p className="text-[12px] leading-5 text-ink-secondary">{t("design.modelHint")}</p>
      <label className="block text-[12px] font-medium">{t("design.output")}<select className={`${designInput} mt-1`} value={step.output ?? "text"} onChange={(event) => update({ output: event.target.value === "verdict" ? "verdict" : undefined })}>
        <option value="text">{t("design.outputText")}</option><option value="verdict">{t("design.outputVerdict")}</option>
      </select></label>
      <label className="block text-[12px] font-medium">{t("design.criteria")}<textarea className={`${designInput} mt-1`} rows={2} value={step.criteria ?? ""} maxLength={4000} placeholder={t("design.criteriaPlaceholder")} onChange={(event) => update({ criteria: event.target.value.trim() ? event.target.value : undefined })} /></label>
      {incoming > 0 && <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <label className="flex items-center gap-2 pb-2 text-[12px] font-medium"><input type="checkbox" checked={Boolean(step.forEach)} onChange={(event) => update({ forEach: event.target.checked || undefined, concurrency: event.target.checked ? step.concurrency : undefined })} />{t("design.forEach")}</label>
        {step.forEach && <label className="block text-[12px] font-medium">{t("design.concurrency")}<input type="number" min={1} max={8} className={`${designInput} mt-1 w-20`} value={step.concurrency ?? 3}
          onChange={(event) => update({ concurrency: Math.min(8, Math.max(1, Math.round(Number(event.target.value) || 1))) })} /></label>}
      </div>}
    </>}
    {incoming > 1 && <label className="block text-[12px] font-medium">{t("design.join")}<select className={`${designInput} mt-1`} value={String(step.join ?? "any")}
      onChange={(event) => update({ join: event.target.value === "any" ? undefined : event.target.value === "all" ? "all" : Number(event.target.value) })}>
      <option value="any">{t("design.joinAny")}</option><option value="all">{t("design.joinAll")}</option>
      {Array.from({ length: incoming - 2 }, (_, i) => i + 2).map((count) => <option key={count} value={count}>{t("design.joinQuorum", { count, total: incoming })}</option>)}
    </select></label>}
  </>;
}
