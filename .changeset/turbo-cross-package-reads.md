---
"@systemfsoftware/stryker-js": none
"@systemfsoftware/stryker-js-cli-contract": none
---

Build: each package's `turbo.json` declares the root files its tests read (`pnpm-lock.yaml`, `pnpm-workspace.yaml`), so Turbo re-runs those tests when the files change. No published file changes.
