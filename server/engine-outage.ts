import { classifyError } from "./drivers/retry.ts";

/** Waits before each retry of work whose engine failed for a passing reason: minutes, not the driver's seconds. */
export const OUTAGE_RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 300_000, 600_000, 1_200_000];

/** A failure worth waiting out: the drivers' transient classes, and a 5xx or 429 that codex-cli words as
 * "unexpected status 502 Bad Gateway", which the drivers read as a malformed request. */
export function waitableEngineFailure(text: string): boolean {
  return /\bunexpected status (?:5\d\d|429)\b/i.test(text) || classifyError({ text }).transient;
}

export async function outageWait(ms: number, signal: AbortSignal, tick?: () => void): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    const heartbeat = tick ? setInterval(tick, 60_000) : undefined;
    function done() {
      clearTimeout(timer);
      clearInterval(heartbeat);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
  signal.throwIfAborted();
}

export function outageRetryNote(text: string): string {
  return `[OpenMausBot: the previous attempt stopped on an engine error (${text.replace(/\s+/g, " ").slice(0, 200)}). The engine is being retried; continue the same work from where it stopped.]`;
}
