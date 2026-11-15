# Review

@CODING_STANDARDS.md

This file holds this repository's review policy: what each severity means here and the evidence a finding needs. The rules a change is checked against live in `CODING_STANDARDS.md` (and the subtree files it names) and in `CONSTITUTION.md`.

## Severity

- **P0:** a violation of `CONSTITUTION.md`, which outranks every other file here and admits no appeal; a change that makes a mutation verdict wrong (a mutant reported Killed, Survived, Timeout or NoCoverage that is not); a published package that fails to install or start; or a secret, private name or private link entering this public repository (the public-repository pack).
- **P1:** a breach of a `CODING_STANDARDS.md` rule; a hang, a lost exit code or a CI verdict without positive evidence; a fix softened or shimmed to avoid a break (see "Breaking changes" in `CODING_STANDARDS.md`).
- **P2:** anything else the diff introduced that a reader or a later change would trip over.

## Evidence a finding needs

- It reproduces on the pull request's current head, and the diff introduced it.
- The rule it cites covers this surface by the rule's own stated scope.
- An end-to-end or mutation failure is diagnosed from the run's exported traces (the `e2e-telemetry-*` artifact, or Tempo from `pnpm lgtm:up`) and names the trace and span, not from added print statements or speculative retries.
- A claim about a tool's behavior (Stryker, Vitest, tsc, tsgo, Node, pnpm, turbo) cites a run of that tool or its source, not documentation alone.
