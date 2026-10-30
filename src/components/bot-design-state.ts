import { useEffect, useRef, useState } from "react";
import { api } from "@/state/store";
import {
  botDesignSchema,
  type BotDesign,
  type BotDesignState,
  type BotProcessConsultant,
} from "../../shared/bot-design";
import type { WireMessage } from "../../shared/wire";

type Snapshot = BotDesignState & { activity: WireMessage[]; consultants: BotProcessConsultant[] };
export function useBotDesign(botId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<BotDesign>(botDesignSchema.parse({}));
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [proposal, setProposal] = useState<BotDesign | null>(null);
  const savedDesign = useRef<BotDesign | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const path = `/api/bots/${botId}/design`;
  useEffect(() => {
    mounted.current = true;
    savedDesign.current = null;
    setSnapshot(null);
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await api<Snapshot>(path);
        if (cancelled) return;
        const previous = savedDesign.current;
        savedDesign.current = result.design;
        setSnapshot(result);
        setDraft(current => !previous || JSON.stringify(current) === JSON.stringify(previous) ? result.design : current);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1800);
    return () => {
      cancelled = true;
      mounted.current = false;
      clearInterval(timer);
    };
  }, [path]);
  const act = async (name: string, action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(name);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
      if (mounted.current) setWorking("");
    }
  };
  const save = () =>
    act("save", async () => {
      const checked = botDesignSchema.parse(draft);
      const result = await api<BotDesignState>(path, {
        method: "PUT",
        body: JSON.stringify(checked),
      });
      if (mounted.current) {
        savedDesign.current = result.design;
        setDraft(result.design);
        setSnapshot((current) => ({
          ...result,
          activity: current?.activity ?? [],
          consultants: current?.consultants ?? [],
        }));
      }
    });
  const run = (input: string) =>
    act("run", async () => {
      await api(`${path}/run`, {
        method: "POST",
        body: JSON.stringify({ input }),
      });
      const result = await api<Snapshot>(path);
      if (mounted.current) setSnapshot(result);
    });
  const stop = () =>
    act("stop", async () => {
      await api(`${path}/stop`, { method: "POST" });
      const result = await api<Snapshot>(path);
      if (mounted.current) setSnapshot(result);
    });
  const propose = (message: string) =>
    act("propose", async () => {
      const result = await api<{ proposal: BotDesign }>(`${path}/propose`, {
        method: "POST",
        body: JSON.stringify({ message, design: draft }),
      });
      if (mounted.current) setProposal(result.proposal);
    });
  return {
    snapshot,
    draft,
    setDraft,
    error,
    working,
    proposal,
    setProposal,
    save,
    run,
    stop,
    propose,
    dirty: Boolean(
      snapshot && JSON.stringify(snapshot.design) !== JSON.stringify(draft),
    ),
  };
}
