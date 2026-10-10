---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js": major
---

The verdict line's `phaseDurations` gains `check` and `reporting`. `check` is checker-busy wall-clock (the union of the intervals in which any checker was starting or checking); it overlaps the other phases, and a run with no checker configured reports `{ "_tag": "not-run" }` rather than zero. `reporting` runs from the end of mutant execution to the verdict, so `mutation-test` now stops where `reporting` starts, and the five sequential phases add up to the elapsed time.

Breaking:

- The stream emits a `phase` event for `reporting`, so `RunPhase` gains that value; exhaustive matches over `RunPhase` must handle it.
- `mutation-test` no longer includes reporting time.
- Verdict lines written before this release decode both new members as `{ "_tag": "not-recorded" }`.
