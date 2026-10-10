---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js": minor
---

The verdict line's `phaseDurations` gains `check` and `reporting`. `check` is checker-busy wall-clock (the union of the intervals in which any checker was starting or checking); it overlaps the other phases, and a run with no checker configured reports `{ "_tag": "not-run" }` rather than zero. `reporting` is the time from the end of mutant execution to the verdict; `mutation-test` now ends where it begins, and the five sequential phases add up to the elapsed time.

The stream emits a `phase` event for `reporting`, so `RunPhase` gains that value; exhaustive matches over `RunPhase` must handle it. Verdict lines written before this release decode both new members as `{ "_tag": "not-recorded" }`, and the stream version stays `6.0`.
