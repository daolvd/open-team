import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChrome } from "./browser/chrome/launch.ts";
import { CdpBrowser } from "./browser/cdp/browser.ts";

export async function telegramHtmlPreview(executablePath: string, html: string): Promise<Uint8Array> {
  const profile = await mkdtemp(join(tmpdir(), "omb-telegram-preview-"));
  let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined;
  try {
    chrome = await launchChrome({ executablePath, userDataDir: profile, host: "desktop", mode: "headless", handshakeTimeoutMs: 15000 });
    const browser = await CdpBrowser.connect(chrome.transport, { identity: null, permissions: false, headless: true, viewport: { width: 1100, height: 850 } });
    try {
      const page = await browser.waitForPage();
      // Bot HTML is untrusted: previews execute no scripts and fetch no host or network resources.
      page.session.on("Fetch.requestPaused", ({ requestId }) => {
        void page.session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
      });
      await page.session.send("Fetch.enable", { patterns: [{ urlPattern: "http://*" }, { urlPattern: "https://*" }, { urlPattern: "file://*" }] });
      const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const document = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self' data: about:; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"></head><body style="margin:0"><iframe sandbox srcdoc="${escaped}" style="width:1100px;height:850px;border:0"></iframe></body></html>`;
      await page.navigate(`data:text/html;base64,${Buffer.from(document).toString("base64")}`);
      const shot = await page.session.send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      return Buffer.from(shot.data, "base64");
    } finally { await browser.close(); }
  } finally {
    await chrome?.close(1000);
    await rm(profile, { recursive: true, force: true });
  }
}
