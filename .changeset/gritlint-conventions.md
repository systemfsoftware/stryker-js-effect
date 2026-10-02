---
"@systemfsoftware/stryker-js-instrumenter": none
"@systemfsoftware/stryker-js-typescript-checker": none
"@systemfsoftware/stryker-js-vitest-runner": none
"@systemfsoftware/stryker-js-cli-contract": none
"@systemfsoftware/stryker-js-plugin-interface": none
"@systemfsoftware/stryker-js": none
---

Adopt the systemfsoftware gritlint conventions. Scoped packages publish with explicit public access, the JSON contract documents are exported as objects that resolve to the same files, and stryker-js builds its library and CLI in one tsdown run. Nothing a consumer resolves or runs changes.
