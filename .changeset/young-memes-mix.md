---
"@systemfsoftware/stryker-js": patch
---

Timeout reasons that only start with `Hit limit reached` no longer classify as hit-limit timeouts; the timeout-fields property now draws every deciding input class under the mutation-worker budget.
