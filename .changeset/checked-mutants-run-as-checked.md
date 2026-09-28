---
"@systemfsoftware/stryker-js": patch
---

With checkers configured, a mutant is sent to a test runner as soon as its own check group passes instead of waiting for earlier groups, so `mutant` events can arrive out of plan order while the final report keeps plan order.
