---
"@systemfsoftware/stryker-js": minor
---

Every test-runner and checker process boot now publishes a `worker` line on the machine stream carrying its role, boot ordinal and measured start-up time, so the once-per-worker start-up cost is observable instead of hidden behind the first mutant's per-run overhead. The stream schema version is now `4.0`.
