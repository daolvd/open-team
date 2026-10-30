import { useState } from "react";
import { GitBranch, Plus, Trash2 } from "lucide-react";
import { botProcessWorkflow, type BotDesign, type BotProcessRun } from "../../shared/bot-design";
import { validateWorkflow } from "../../shared/workflow";
import { t } from "@/lib/i18n";
import { designButton, designInput } from "./BotDesignSkills";
import { arrangeProcess, BotProcessCanvas, processStatusKeys } from "./BotProcessCanvas";

export function BotProcessEditor({ design, onChange, run }: {
  design: BotDesign;
  onChange: (design: BotDesign) => void;
  run?: BotProcessRun;
}) {
  const { steps } = design;
  const { edges } = botProcessWorkflow(design);
  const [selectedId, setSelectedId] = useState("");
  const [edgeIndex, setEdgeIndex] = useState<number | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0];
  const index = steps.findIndex((step) => step.id === selected?.id);
  const result = run?.steps.find((step) => step.id === selected?.id);
  const edge = edgeIndex === null ? undefined : edges[edgeIndex];
  const update = (patch: { title?: string; instruction?: string }) => onChange({ ...design, steps: steps.map((step) => step.id === selected?.id ? { ...step, ...patch } : step) });
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
  return <section aria-labelledby="design-steps-title" className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="design-steps-title" className="text-[15px] font-semibold">{t("design.steps")}</h3>
      <div className="flex flex-wrap gap-2">
        {steps.length > 0 && <button type="button" className={designButton} onClick={() => onChange({ ...design, steps: arrangeProcess(design) })}>{t("design.arrange")}</button>}
        <button type="button" className={`${designButton} inline-flex items-center gap-1`} disabled={steps.length >= 24} onClick={addStep}><Plus size={14} />{t("design.addStep")}</button>
      </div>
    </div>
    <p className="mt-2 text-[12px] leading-5 text-ink-secondary">{t("design.flowHint")}</p>
    {connecting && <p role="status" className="mt-2 flex items-center justify-between gap-2 text-[12px] text-accent-text">{t("design.connectHint")}<button type="button" className={designButton} onClick={() => setConnecting(null)}>{t("design.cancelConnection")}</button></p>}
    {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    <div className="mt-3 min-w-0 space-y-3">
      <BotProcessCanvas design={design} selectedId={selected?.id ?? ""} connecting={connecting} onSelect={(id) => { setSelectedId(id); setEdgeIndex(null); }} onConnect={connect} onConnecting={setConnecting} onChange={onChange} onEdge={setEdgeIndex} run={run} empty={
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 px-5 py-8 text-center">
          <button type="button" className="inline-flex min-h-20 items-center gap-2 rounded-xl border border-dashed border-accent bg-card px-6 text-[14px] font-medium text-accent-text hover:bg-control focus-visible:outline-2 focus-visible:outline-accent" onClick={addStep}><Plus size={18} />{t("design.addFirstStep")}</button>
          <p className="max-w-sm text-[12px] leading-5 text-ink-secondary">{t("design.emptySteps")}</p>
          <button type="button" className={`${designButton} inline-flex items-center gap-2`} onClick={addParallelExample}><GitBranch size={15} />{t("design.parallelExample")}</button>
        </div>
      } />
      {selected && <>
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
        <label className="block text-[12px] font-medium">{t("design.stepInstruction", { number: index + 1 })}<textarea className={`${designInput} mt-1`} rows={5} value={selected.instruction} maxLength={8000} placeholder={t("design.stepInstructionPlaceholder")} onChange={(event) => update({ instruction: event.target.value })} /></label>
        {result && run && <div className="border-t border-hairline/40 pt-3 text-[12px]"><p className="flex flex-wrap justify-between gap-2 text-ink-secondary"><span>{t("design.history")}</span><span>{new Date(run.startedAt).toLocaleString()} · {t(processStatusKeys[result.status])}</span></p>{(result.output || result.error) && <div className="mt-3"><p className="font-medium">{t(result.error ? "design.error" : "design.output")}</p><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">{result.error ?? result.output}</pre></div>}</div>}
      </div>}
      </>}
    </div>
  </section>;
}
