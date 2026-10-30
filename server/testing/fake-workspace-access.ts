import { randomUUID } from "node:crypto";
import { hostedWorkspaceConfiguration, type WorkspaceAccess, type WorkspaceAccessOptions } from "../enterprise.ts";
import type { Scope } from "../sessions.ts";

// Test-only identity exchange: this is not a production sign-in or PKCE implementation.
export function createWorkspaceAccess(options: WorkspaceAccessOptions): WorkspaceAccess {
  const env = options.env ?? process.env;
  const config = hostedWorkspaceConfiguration(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const starts = new Set<string>();
  const grants = new Map<string, { grant: string; scopes: Scope[] }>();
  const revoke = (id: string) => {
    options.sessions.revoke(id);
    grants.delete(id);
    options.closeSessionStreams(id);
  };
  const check = async (id: string): Promise<{ status: 401 | 503; error: string } | null> => {
    const saved = grants.get(id);
    if (!saved) return { status: 401, error: "Fixture portal session required" };
    if (!config || !options.entitled()) return { status: 503, error: "Fixture adapter unavailable" };
    try {
      const response = await fetchImpl(new URL("/api/handoff/check", config.admin), {
        method: "POST", body: JSON.stringify({ workspace: config.workspace, grant: saved.grant }),
      });
      if (!response.ok) {
        revoke(id);
        return { status: 401, error: "Fixture membership revoked" };
      }
      const identity = await response.json() as { role: string };
      if (saved.scopes.includes("admin") && identity.role !== "admin") {
        revoke(id);
        return { status: 401, error: "Fixture permissions changed" };
      }
      return null;
    } catch {
      options.closeSessionStreams(id);
      return { status: 503, error: "Fixture identity service offline" };
    }
  };
  return {
    async handlePublic(req, res, url) {
      if (config && options.entitled() && ["/", "/pair"].includes(url.pathname) && req.headers.host === config.tenant.host) {
        const token = req.headers.cookie?.split("; ").find((cookie) => cookie.startsWith(`${options.cookieName}=`))?.slice(options.cookieName.length + 1);
        if (!options.sessions.authenticate(token)) {
          res.writeHead(302, { location: "/api/auth/hosted/start" });
          res.end(); return true;
        }
      }
      if (!["/api/auth/hosted/start", "/api/auth/hosted/callback"].includes(url.pathname)) return false;
      if (!config || !options.entitled()) {
        res.writeHead(503); res.end("Fixture adapter unavailable"); return true;
      }
      if (url.pathname.endsWith("/start")) {
        const state = randomUUID();
        starts.add(state);
        const target = new URL("/connect", config.admin);
        target.searchParams.set("state", state);
        res.writeHead(302, { location: target.href, "set-cookie": `__Host-fixture=${state}; Path=/; Secure; HttpOnly; SameSite=Lax` });
        res.end(); return true;
      }
      const state = url.searchParams.get("state") ?? "";
      if (!starts.delete(state) || !req.headers.cookie?.split("; ").includes(`__Host-fixture=${state}`)) {
        res.writeHead(401); res.end("Invalid fixture state"); return true;
      }
      try {
        const response = await fetchImpl(new URL("/api/handoff/consume", config.admin), {
          method: "POST", body: JSON.stringify({ workspace: config.workspace, code: url.searchParams.get("code") }),
        });
        if (!response.ok) throw new Error("Fixture membership refused");
        const identity = await response.json() as { email: string; role: string; grant: string };
        const scopes: Scope[] = identity.role === "admin" ? ["admin", "client"] : ["client"];
        const issued = options.sessions.issuePortal({ email: identity.email, grant: identity.grant, scopes });
        grants.set(issued.session.id, { grant: identity.grant, scopes });
        res.writeHead(302, { location: "/", "set-cookie": `${options.cookieName}=${issued.token}; Path=/; Secure; HttpOnly; SameSite=Lax` });
        res.end(); return true;
      } catch {
        res.writeHead(503); res.end("Fixture identity service unavailable"); return true;
      }
    },
    async authorize(_req, auth) {
      return auth.kind === "loopback" ? null : check(auth.session.id);
    },
    async revalidate() {
      await Promise.all([...grants.keys()].map(check));
    },
  };
}
