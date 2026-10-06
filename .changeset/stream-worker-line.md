---
"@systemfsoftware/stryker-js-cli-contract": minor
---

The machine stream declares version `6.0` and carries a new `worker` line, `{ _tag: "worker", schemaVersion, role, index, startupMs }`, emitted once per test-runner or checker process boot. A consumer that switches exhaustively over the stream's event tags must handle the new tag; the start-up cost of a reused worker is now visible instead of being folded into the first mutant's cost.
