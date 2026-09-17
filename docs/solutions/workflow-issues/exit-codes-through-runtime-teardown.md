---
title: Exit codes publish through the runtime teardown, not signal arithmetic
date: 2026-09-17
input_shape: solution
subject: CLI exit-code contract via Runtime defaultTeardown
applies_when:
  - publishing a process exit code from an Effect program
  - handling SIGINT/SIGTERM in a runMain-based CLI
---

# Exit codes publish through the runtime teardown, not signal arithmetic

`NodeRuntime.runMain` with the default teardown already maps outcomes to exit
codes: success to 0, interrupt-only causes to 130, and a squashed failure
carrying `[Runtime.errorExitCode]` to that number. A `TaggedError` subclass
stamps its code with a getter, and the tail publishes by failing with it:

```text
export class RunExit extends S.TaggedError<RunExit>()("RunExit", { code: S.Finite }) {
  get [Runtime.errorExitCode](): number {
    return this.code
  }
}
```

## Architectural invariants

**INV-1: One interrupt outcome, one constant.** The workflow's interrupted
branch is the only place 130 is constructed (`RunInterrupted.make({ code: 130
})`); the tail reuses the classified code instead of recomputing `128 + n`.
Rationale: a second arithmetic site drifts the moment a new signal path
appears; one constant keeps SIGINT and SIGTERM identical by construction.

**INV-2: The tail publishes, never observes.** No signal observer, no
`process.on` arms in the run — `runMain` already interrupts the main fiber on
SIGINT/SIGTERM. The tail classifies the resulting exit and fails with the
stamped error. Rationale: an observer duplicates the runtime's own
interruption and races it.

**INV-3: Interrupt inside an uninterruptible mask is a stamped failure, not
`Effect.interrupt`.** `Effect.interrupt` under `uninterruptibleMask` without
`restore` converts to a defect, and the teardown resolves defects to 1 — the
documented 130 never surfaces. Failing with `RunExit.make({ code:
interrupted.code })` carries the code through the mask because typed failures
are values, not interruptions. Rationale: the mask exists to keep
reporting/cleanup alive; the exit code must travel as data across it.

**INV-4: `restore` stays on the use, not the report.** `Effect.exit(restore(use))`
classifies the program's real outcome; everything after (span annotation,
machine output, drain, publish) runs masked. Rationale: restoring the tail
would let a second signal kill the reporting the first signal interrupted.

## Code smells

- `128 + signal` arithmetic in CLI code → a constant on the classified outcome.
- `onFailure: () => Effect.interrupt` inside `uninterruptibleMask` → fail with the
  stamped error carrying the already-classified code.
- A success-fallback (`.pipe(Effect.orElseSucceed(2))`) after a tail that ends in
  `RunExit`/interrupt → delete it; the tail classifies every failure already,
  so the fallback guards an unreachable path and would swallow the code.
- `process.exit` inside an Effect → return the stamped failure and let the
  teardown own the single interpretation edge in `main.ts`.
