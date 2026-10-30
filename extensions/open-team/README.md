# Open Team workspace module

This independently written module uses the Apache-licensed core's feature
interfaces. It contains no upstream Enterprise implementation and uses the
repository's Apache-2.0 license. No license key or license server is required.

Copy `open-team.example.json` to `$OMB_DATA_DIR/open-team.json` and restart the
server. Without a file, all three local features are available. A malformed
file stops startup with its path and validation error.

- `name`: workspace name in the server's edition status.
- `features.whitelabel`: apply `$OMB_DATA_DIR/brand.json`, for example
  `{"name":"My Team","accent":"#2563EB"}`.
- `features.budgets`: enforce `budgets.monthlyUsd` and `budgets.warnAtPercent`
  from the existing `config.json` against recorded usage.
- `features.billing`: use the model prices in `config.json` under
  `billing.prices`. This estimates cost; it does not collect payments.

Changes to feature flags apply after restart. Budget and pricing accuracy
depends on the engine's reported usage and the configured prices.

This module supports standalone workspaces. It does not implement hosted
portal membership, SSO or the upstream Admin service. A configured hosted
workspace still refuses access without an appropriate authentication adapter.
The optional `OMB_ENTERPRISE_DIR` compatibility loader takes precedence when
explicitly configured and applies that external adapter's license contract.

The module is bundled into desktop, npm and Docker server entry points.
Edit `server/index.ts` in this directory to define additional local features.
