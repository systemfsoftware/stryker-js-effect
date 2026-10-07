---
title: Key the verdict cache by content, not by run
date: 2026-09-28
category: tooling-decisions
problem_type: stale and false-miss verdict reuse from incidental cache-key inputs
input_shape: solution
subject: A mutation verdict is reusable exactly when the mutant's content, its covering tests' closure, the run inputs that change behavior, the verdict semantics, and the mutant-set policy are identical - so the key names none of the things that vary between shards, branches, paths, and machines
applies_when:
  - changing what enters the verdict-cache key or the run-inputs fingerprint
  - relocating, sharding, or merging incremental reports
  - widening the project-file crawl that feeds the test closure digest
  - changing which inputs open a closure or how workspace and installed imports resolve
  - deciding whether a release must declare `Verdict-Semantics: changed`
---

# Key the verdict cache by content, not by run

## Problem

An incremental mutation run must reuse a verdict when re-running would produce
the same answer, and refuse it otherwise. Two opposite failures are silent:

- **False reuse.** A key narrower than the verdict's real inputs serves a stale
  status - a killed mutant reported killed after the code that killed it moved
  or changed.
- **False miss.** A key wider than the verdict's real inputs refuses a verdict
  every repeat run, so the cache pays full cost and looks like it works.

Both hide behind a green run. A cache keyed on anything a run happens to carry

- the report path, the shard, the branch, the tool version, the reporter set -
  produces one or the other.

## Failure mechanism

1. **Positional identity.** A per-run counter id changes when unrelated code
   shifts, so every repeat run looks like new work. Identity has to derive from
   the mutant's content: the repo-relative file, the mutator, the original
   node's source text, the replacement, and the ordinal among identical tuples.
2. **Per-function reuse.** Deciding reuse from dynamic call edges is the least
   precise of the measured regression-selection techniques, so a test that
   reaches a mutant through a helper is missed. Reuse has to close over the
   static import graph of the covering test file, over-including whatever the
   parser cannot resolve.
3. **Self-invalidation.** The project-file crawl that feeds the closure digest
   sees the artifacts the run itself writes - the temp directory, the
   incremental file, the progress stream, the HTML/JSON/SARIF reports, the
   reproducer sidecar. Every run then changes its own inputs and refuses its own
   verdicts.
4. **Presentation in the key.** Reporters, console colors, and other
   presentation options do not change a status, but a fingerprint that includes
   them refuses every verdict whenever a report format changes.
5. **Unreproducible verdicts.** Caching a wall-clock Timeout pins a flake
   forever; a timeout caused by the environment is not a property of the mutant.
6. **Every closure open.** An open closure falls back to the whole-project
   digest, so one input that can never resolve opens every covering test's
   closure and any edit anywhere refuses every covered verdict. In
   `@systemfsoftware/stryker-js` the causes were a runner-reported setup file under
   `node_modules` and sibling workspace imports outside the project root. All
   177 test closures were open, and main Mutation runs 37528187988 (#203) and
   37538468691 (#206) each re-ran 4833 of 5131 mutants after a one-file edit
   (closure digests compared between consecutive merged reports).

## Architectural Invariants

- **A verdict's key is its content and its true inputs.** The key is the
  mutant id, the covering tests' closure digest, the run-inputs digest, the
  verdict-semantics version, and the mutant-set policy. Nothing in it names a
  shard, a branch, a report path, or a machine, so reports computed anywhere
  union by key.
- **The fingerprint carries only behavior-affecting inputs.** Exclude
  scope-only options (the `mutate` patterns, `since`, explicit mutant ids) and
  every environment-derived or presentation option (reporters, console colors,
  reporter color flags). A run scoped to fewer mutants, or rendered
  differently, still produces the same verdict for the mutants it runs.
- **A run never feeds its own inputs.** The crawl that computes the closure
  digest excludes every declared Stryker output path. `strykerOutputFilesOf`
  is the one list of those paths; a new sidecar joins it there, not in a second
  place.
- **Refusal is named.** Every mutant a key refuses carries exactly one reason
  by fixed precedence - semantics changed, policy changed, run inputs changed,
  closure changed, a flaky dependency, a timeout that has not reproduced, or no
  prior record - and the run's `reuse` line partitions reused, ran, and refused
  so the split is auditable.
- **A closure opens only on a dynamic specifier.** Workspace links are followed
  and their sources hashed; an installed file the runner reports (a setup file)
  is a content-hashed leaf whose imports are not followed, because the
  lockfile and manifest digest covers `node_modules`. The closure's test set is
  the configured test files plus every test file the dry run observed, so a
  runner-discovered test cannot leave its closure unhashed. Gate:
  `pnpm --filter @systemfsoftware/stryker-js exec vitest run tests/import-closure.integration.test.ts tests/incremental-reuse.integration.test.ts`
  fails when an installed setup file, a workspace import, or an observed-only
  test file opens a closure or goes unhashed.
- **Only reproducible verdicts are cached.** A wall-clock Timeout is reused
  only after it reproduces; a hit-limit Timeout is reused on first sight.
- **Verdict semantics are declared per branch.** A commit trailer
  `Verdict-Semantics: changed|unchanged` is read across merge-base..HEAD; every
  commit on a branch must agree, and `changed` must coincide with a bumped
  semantics constant. A release that alters what a status means without
  declaring it is caught by this guard, not by memory.

```text
key(mutant) = (
  contentId(mutant),
  closureDigest(coveringTests(mutant)),        # static import closure, open on unresolved specifiers
  runInputsDigest(options minus scope minus presentation minus environment),
  verdictSemanticsVersion,
  mutantSetPolicy,
)
reuse(mutant) = priorEntry with the same key, else refuse(named reason)
```

## Verification

- Run an unchanged project twice: the second run reuses every verdict and
  reports zero refusals. A refusal count above zero on an unchanged tree is the
  false-miss signature.
- Move an incremental report to another path and list it through the report
  globs: the verdicts are still reused, proving the key does not name a path or
  shard.
- Change a presentation option (reporters, console colors) and re-run: reuse is
  unchanged. Change the code of a helper two imports below a covering test, and
  only that test's dependents are refused. On a real package, count open test
  closures: anything beyond genuine `import(variable)` sites is a resolver gap
  that turns every edit into a near-full run.
- Compare a cached status table with two forced cold runs and subtract their
  own disagreement set: any remaining difference is a false reuse, which is why
  the cold backstop subtracts measured engine noise rather than trusting a
  frozen noise list.
- Code smell: a new report sidecar added to the reporter set but not to
  `strykerOutputFilesOf`; a scope option added to the run-inputs fingerprint; a
  cache key that strings a report path or a tool version.
