# Open Team module verification

The module is tested using temporary workspace directories and synthetic data:

```sh
pnpm exec vitest run server/open-team.test.ts server/enterprise.test.ts server/brand.test.ts server/spend.test.ts
pnpm test:packaged-server
```

The first check proves default local features without a key, owner feature
switches, branding application, spend controls, invalid configuration rejection
and absence of a hosted authentication adapter. Legacy loader tests use
stand-in adapters; they do not import the excluded Enterprise source.

The packaged smoke boots a disposable server from the bundle. Check
`/api/edition` in an isolated fixture for `edition: "oss"` and the sorted feature
list `billing`, `budgets`, `whitelabel`. A hosted workspace configured without
an authentication adapter must continue refusing access.

The module does not supply hosted SSO, subscriptions or payment collection.
