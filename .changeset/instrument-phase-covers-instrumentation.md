---
"@systemfsoftware/stryker-js": patch
---

The `instrument` phase now covers instrumentation and the sandbox copy. A run used to enter `instrument` only after both had finished, so `phaseDurations.instrument` read close to 0 ms and their time counted under `prepare`. The `instrument` phase event and its `instrument` trace span now start before the files to mutate are read and instrumented, for mutation runs and for plans. `phaseDurations.instrument` grows by the instrumentation and sandbox time, and `prepare` shrinks by the same amount. A run that fails while instrumenting or building its sandbox now reports the `instrument` phase as entered.
