# External hosted adapter boundary

Open Team supports standalone workspaces through its independent local module.
It does not bundle a portal, SSO adapter or the upstream Enterprise code.
The Apache core retains the external `WorkspaceAccess` contract in
`server/enterprise.ts` and metadata in `server/hosted-contract.ts`.

Hosted configuration requires HTTPS `OMB_ADMIN_URL`, `OMB_PUBLIC_URL`, a valid
`OMB_ADMIN_WORKSPACE`, an explicitly supplied adapter via `OMB_ENTERPRISE_DIR`,
and its current `admin` entitlement. `OMB_ADMIN_MEMBERSHIP=portal` selects the
external membership authority. Incomplete configuration or a missing adapter
refuses remote access. Email and QR authentication cannot bypass that boundary.

Session-less local requests on a hosted workspace use service trust; recovery
with owner trust requires an explicit operator setting. See
[shared-workspace trust](shared-workspace-trust.md).

`GET /api/health/hosted` reports readiness only when complete portal
configuration, the hook and entitlement are present. Successful replies carry
contract metadata and its version header. This reports runtime capability;
it does not prove that an identity service is reachable or secure.

## Isolated verification

Read [the verification entry point](README.md) before running:

```sh
pnpm exec vitest run --no-file-parallelism server/hosted-access.test.ts server/hosted-models-api.test.ts server/enterprise.test.ts server/sessions.test.ts server/request-auth.test.ts
```

The full-server tests load `server/testing/fake-workspace-access.ts` through
a temporary external adapter. Its identity exchange is deliberately synthetic
and confined to disposable homes and injected responses. It checks core
navigation delegation, disabled legacy credentials, scope narrowing, outage
responses, revocation of quiet streams, portal membership, local recovery,
model policy, and readiness withdrawal on expiry.

This fixture does not implement or qualify production sign-in, PKCE, replay
protection, cookie binding, an external identity service or tenant isolation.
Any production adapter needs its own authentication and deployment validation.
The [fleet recipe](fleet.md) covers the separate disposable Linux boundary.
