# External edition adapter compatibility

Open Team starts with its own open-source module. No upstream Enterprise
implementation or signing keys are bundled. See [local module checks](open-team.md).

An operator may explicitly select an independently supplied adapter through
`OMB_ENTERPRISE_DIR`. The Apache core validates its registration result and
retains expiry warnings and a seven-day grace period for that adapter's
entitlements. This is a compatibility interface, not a license issuer.

```sh
pnpm exec vitest run server/enterprise.test.ts server/open-team.test.ts
pnpm exec vitest run --no-file-parallelism server/license-expiry-api.test.ts server/hosted-access.test.ts
pnpm test:packaged-server
```

`server/enterprise.test.ts` creates temporary adapters to verify loader
precedence, invalid registration, warnings, grace and expiration.
`server/license-expiry-api.test.ts` launches isolated servers and checks
admin-only expiry details through the HTTP API. The hosted fixture uses a
synthetic adapter to verify readiness is withdrawn when its entitlement ends.
These tests do not verify cryptographic signatures or production SSO.

The packaged smoke launches the built server outside the checkout, verifies
all three Open Team features load without a valid key, and rejects a bundled
restricted Enterprise directory. The Settings banner has component coverage
in `src/components/LicenseExpiryBanner.test.ts`.
