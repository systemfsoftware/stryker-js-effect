---
"@systemfsoftware/stryker-js-cli": minor
---

Exit codes are now published through the runtime's default teardown: interrupt runs exit 130, and classed failures carry their code on the failure. Runs stopped by SIGTERM now exit 130 instead of 143.
