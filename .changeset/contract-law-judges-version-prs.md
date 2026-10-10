---
"@systemfsoftware/stryker-js-cli-contract": none
---

Tests: the contract version law checks the released documents against the version main declares, not the committed one. A version PR is now judged by the version it declares instead of being refused as a stale baseline. A pin that lags main's version is still refused. Without `origin/main` the law reports `main-baseline-unavailable` with `git fetch origin main` as the next step, and the package's test task is no longer cached. No shipped file changes.
