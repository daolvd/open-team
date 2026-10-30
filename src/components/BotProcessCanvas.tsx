import { useId, useRef, useState, type ReactNode } from "react";
import { Check, GripVertical, Loader2 } from "lucide-react";
import { botProcessWorkflow, type BotDesign, type BotProcessRun } from "../../shared/bot-design";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export const processStatusKeys = {
  pending: "design.pending", running: "design.running", completed: "design.completed",
  failed: "design.failed", cancelled: "design.cancelled", skipped: "design.skipped",
} satisfies Record<string, LocaleKey>;

const width = 200;
const height = 132;

export function arrangeProcess(design: BotDesign): BotDesign["steps"] {
  const { edges } = botProcessWorkflow(design);
  const levels = new Map<string, number>();
  const level = (id: string): number => {
    if (levels.has(id)) return levels.get(id)!;
    const parents = edges.filter((edge) => edge.to === id);
    const value = parents.length ? Math.max(...parents.map((edge) => level(edge.from))) + 1 : 0;
    levels.set(id, value);
    return value;
  };
  const rows = new Map<number, number>();
  return design.steps.map((step) => {
    const row = level(step.id);
    const column = rows.get(row) ?? 0;
    rows.set(row, column + 1);
    return { ...step, x: 30 + column * 260, y: 30 + row * 210 };
  });
}

export function BotProcessCanvas({ design, selectedId, connecting, onSelect, onConnect, onConnecting, onChange, onEdge, run, empty }: {
  design: BotDesign;
  selectedId: string;
  connecting: string | null;
  onSelect(id: string): void;
  onConnect(from: string, to: string): void;
  onConnecting(id: string | null): void;
  onChange(design: BotDesign): void;
  onEdge(index: number): void;
  run?: BotProcessRun;
  empty: ReactNode;
}) {
  const marker = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ id: string; x: number; y: number; clientX: number; clientY: number } | null>(null);
  const draggedConnection = useRef(false);
  const [wire, setWire] = useState<{ x: number; y: number } | null>(null);
  const layout = arrangeProcess(design);
  const nodes = design.steps.map((step, index) => ({ ...step, x: step.x ?? layout[index]!.x!, y: step.y ?? layout[index]!.y! }));
  const { edges } = botProcessWorkflow(design);
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x} ${a.y} C${a.x} ${a.y + 60} ${b.x} ${b.y - 60} ${b.x} ${b.y}`;
  const canvasWidth = Math.max(520, ...nodes.map((step) => step.x + width + 30));
  const canvasHeight = Math.max(360, ...nodes.map((step) => step.y + height + 40));
  const source = nodes.find((step) => step.id === connecting);
  return (
    <div className="min-w-0">
      {nodes.length > 0 && <div className="mb-2 flex items-center justify-end gap-2 text-[12px]">
        <button type="button" className="rounded-md border border-hairline/40 px-2 py-1 hover:bg-control" onClick={() => { if (viewport.current) setZoom(Math.min(1, viewport.current.clientWidth / canvasWidth, 560 / canvasHeight)); }}>{t("design.fitView")}</button>
        <button type="button" className="rounded-md border border-hairline/40 px-2 py-1 hover:bg-control" onClick={() => setZoom(1)} aria-label={t("design.actualSize")}>100%</button>
        <span className="text-ink-secondary">{Math.round(zoom * 100)}%</span>
      </div>}
    <div ref={viewport} aria-label={t("design.flow")} className="max-h-[580px] min-w-0 overflow-auto rounded-xl border border-hairline/40 bg-inset" onKeyDown={(event) => { if (event.key === "Escape") { onConnecting(null); setWire(null); } }}>
      {nodes.length === 0 ? <div data-process-canvas>{empty}</div> : <div style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
      <div data-process-canvas className="relative origin-top-left" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }}>
        <svg className="absolute inset-0 h-full w-full overflow-visible text-ink-secondary" aria-label={t("design.connections")}>
          <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="currentColor" /></marker></defs>
          {edges.map((edge, index) => {
            const a = nodes.find((step) => step.id === edge.from)!;
            const b = nodes.find((step) => step.id === edge.to)!;
            const start = { x: a.x + width / 2, y: a.y + height + 10 };
            const end = { x: b.x + width / 2, y: b.y - 12 };
            return <g key={`${edge.from}:${edge.to}`} data-process-connection>
              <path d={curve(start, end)} fill="none" stroke="currentColor" strokeWidth="2" markerEnd={`url(#${marker})`} />
              <foreignObject x={(start.x + end.x) / 2 - 55} y={(start.y + end.y) / 2 - 14} width="110" height="30">
                <button type="button" aria-label={t("design.editConnection", { from: a.title || String(nodes.indexOf(a) + 1), to: b.title || String(nodes.indexOf(b) + 1) })} className="h-7 w-full truncate rounded-md border border-hairline/40 bg-card px-2 text-[11px] text-ink hover:bg-control focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onEdge(index)}>{edge.contains || t("design.always")}</button>
              </foreignObject>
            </g>;
          })}
          {source && wire && <path d={curve({ x: source.x + width / 2, y: source.y + height + 10 }, wire)} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" className="pointer-events-none text-accent" />}
        </svg>
        {nodes.map((step, index) => {
          const status = run?.steps.find((entry) => entry.id === step.id)?.status;
          return <div key={step.id} data-process-step={step.id} className={`absolute rounded-xl border bg-card ${selectedId === step.id || status === "running" ? "border-accent" : "border-hairline/60"}`} style={{ left: step.x, top: step.y, width, height }}>
            <button type="button" data-process-input={step.id} aria-label={t("design.connectInto", { number: index + 1 })} className={`absolute -top-3 left-1/2 z-10 h-6 -translate-x-1/2 rounded-full border bg-card px-3 text-[11px] focus-visible:outline-2 focus-visible:outline-accent ${connecting ? "border-accent text-accent-text hover:bg-control" : "border-hairline/60 text-ink-secondary"}`} onClick={() => { if (connecting) onConnect(connecting, step.id); }}>{t("design.inputPort")}</button>
            <button type="button" data-process-drag aria-label={t("design.dragStep", { number: index + 1 })} className="absolute right-1 top-4 z-10 flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md text-ink-secondary hover:bg-control focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
              onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: step.id, x: step.x, y: step.y, clientX: event.clientX, clientY: event.clientY }; }}
              onPointerMove={(event) => { const d = drag.current; if (!d || d.id !== step.id) return; onChange({ ...design, steps: design.steps.map((entry) => entry.id === d.id ? { ...entry, x: Math.max(0, Math.min(5000, d.x + (event.clientX - d.clientX) / zoom)), y: Math.max(0, Math.min(5000, d.y + (event.clientY - d.clientY) / zoom)) } : entry) }); }}
              onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><GripVertical size={14} /></button>
            <button type="button" aria-pressed={selectedId === step.id} aria-current={status === "running" ? "step" : undefined} aria-label={t("design.selectStep", { number: index + 1, title: step.title || t("design.stepTitlePlaceholder") })} className="h-full w-full rounded-xl px-3 py-5 text-left hover:bg-control focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onSelect(step.id)}>
              <span className="mr-5 flex items-center gap-2 text-[13px] font-medium"><span className="text-ink-secondary">{index + 1}.</span><span className="truncate">{step.title || t("design.stepTitlePlaceholder")}</span>{status === "running" && <Loader2 size={14} className="shrink-0 animate-spin text-accent motion-reduce:animate-none" />}{status === "completed" && <Check size={14} className="shrink-0 text-success" />}</span>
              <span className="mt-2 line-clamp-2 break-words text-[12px] leading-4 text-ink-secondary">{step.instruction || t("design.stepInstructionPlaceholder")}</span>
              {status && <span className={`mt-1 block text-[11px] ${status === "failed" ? "text-danger" : status === "running" ? "text-accent" : "text-ink-secondary"}`}>{t(processStatusKeys[status])}</span>}
            </button>
            <button type="button" aria-label={t("design.connectFrom", { number: index + 1 })} aria-pressed={connecting === step.id} className="absolute -bottom-3 left-1/2 z-10 h-6 -translate-x-1/2 touch-none rounded-full border border-accent bg-card px-3 text-[11px] text-accent-text hover:bg-control focus-visible:outline-2 focus-visible:outline-accent"
              onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); draggedConnection.current = false; onConnecting(step.id); }}
              onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = event.currentTarget.closest("[data-process-canvas]")!.getBoundingClientRect(); setWire({ x: (event.clientX - bounds.left) / zoom, y: (event.clientY - bounds.top) / zoom }); draggedConnection.current = true; }}
              onPointerUp={(event) => { if (!draggedConnection.current) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-process-input]")?.getAttribute("data-process-input"); if (target) onConnect(step.id, target); setWire(null); }}
              onLostPointerCapture={() => setWire(null)}
              onClick={() => { if (draggedConnection.current) { draggedConnection.current = false; return; } onConnecting(step.id); }}>{t("design.outputPort")}</button>
          </div>;
        })}
      </div>
      </div>}
    </div>
    </div>
  );
}
