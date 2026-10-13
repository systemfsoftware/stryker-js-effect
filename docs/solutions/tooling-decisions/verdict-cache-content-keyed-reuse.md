---
title: Key the verdict cache by content, not by run
date: 2026-09-28
last_updated: 2026-10-11
category: tooling-decisions
problem_type: stale and false-miss verdict reuse from incidental cache-key inputs
input_shape: solution
subject: A mutation verdict is reusable exactly when the mutant's content, its covering tests' closure, the run inputs that change behavior, the checker configuration, the engine that produced it, and the mutant-set policy are identical - so the key names no shard, branch, report path, or store location, and each verdict is stored as its own entry named by that key; it does carry the workspace root, because mutant identity hashes the absolute file path, so saved coverage and verdicts are reused only under the root that recorded them
applies_when:
  - changing what enters the verdict key or the run-inputs fingerprint
  - sharing, relocating, or sharding a verdict store, or adding a store driver
  - sharing incremental reports or saved coverage between workspaces at different absolute paths
  - widening the project-file crawl that feeds the test closure digest
  - changing which inputs open a closure or how workspace and installed imports resolve
  - changing which installed files identify the engine that produced a verdict
  - changing how mutant identity is derived
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
   shifts, so every repeat run looks like new work. Identity derives from the
   mutant's content: the instrumented file's name, the mutator, the original
   node's source text, the replacement, and the ordinal among identical tuples
   (`mutantIdOf`). The file name is the absolute path the project crawl
   produced, not a repo-relative one: the script transformer hashes
   `originFileName` as given and uses the base path only to print placement
   locations. So the same file at another workspace root yields different
   mutant ids.
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
   (closure digests compared between consecutive merged reports). After #215,
   130 of 177 were still open for a third cause: a linked sibling package's
   files are keyed by absolute path, and the package lookup searched
   `node_modules` from the project root instead of from the importing file. So
   `@oxc-project/types`, which only `@systemfsoftware/stryker-ignorer-interface`
   installs, went unresolved.
7. **Coverage trusted across roots.** Every per-mutant map a run saves - the
   dry run's per-test coverage, the per-mutant cost estimates, the verdicts -
   is keyed by those root-bound ids. A report copied into a second root and
   checked only by digests passes: with no `testFiles` configured, the closure
   digest reduces to root-relative keys and matches. The run then reuses the
   copied coverage, looks up its own ids, misses every one, and plans every
   mutant `NoCoverage` while logging a successful reuse; the planner prices the
   dry run at zero from the same coverage. Verdict reuse across roots was
   already zero for the same reason, so the visible damage was the wrong
   statuses, not a lost cache hit.

## Architectural Invariants

- **A verdict's key is its content and its true inputs.** The key is the
  mutant id, the covering tests' closure digest and ids, the run-inputs digest,
  the checkers' configuration digest, the engine digest, and the mutant-set
  policy; a CompileError verdict substitutes the checker's program digest for
  the closure. Nothing in it names a shard, a branch, a report path, or the
  store's location. It does carry the workspace root: `mutantIdOf` and the
  key's file-name component hash the absolute file path, so verdicts meet by
  key in one store only between checkouts at the same absolute path, and a
  checkout elsewhere finds no entries and counts every mutant `noPriorRecord`.
  `encodeVerdictKey` derives it. Gate:
  `pnpm --filter @systemfsoftware/stryker-js exec vitest run encode-verdict-key.workflow.property`
  fails when a component change keeps the key or equal components split it.
- **A store holds one immutable entry per key.** An entry lives at
  `<store>/<scheme>/<mutantId>/<kind>-<key>.json`, where `<scheme>` is
  `schemeNameOf(VerdictKeyScheme)`, so a store written under another key or id
  scheme is a clean miss rather than a misread. The filesystem driver writes a
  temporary file and renames it, and S3 never exposes a partial object. Two
  writers of one key both hold a verdict for identical inputs, differing only
  in measured cost and settle time, so the last writer winning loses nothing.
  A reader skips a torn or undecodable entry and counts it as
  `entryUnreadable`; it never fails the run. Every driver passes the one law
  suite in `verdict-store/laws`. Gate:
  `pnpm --filter @systemfsoftware/stryker-js exec vitest run verdict-store-laws.integration`
  (in-memory fake and filesystem) and
  `pnpm --filter @systemfsoftware/stryker-js-verdict-store-s3 exec vitest run s3-verdict-store.laws.integration`
  (S3 against `emulate`).
- **Whoever can write a store can forge a verdict.** Reuse trusts every entry
  whose key matches. Share a store only between writers you trust, as you
  would a build cache. A store the run cannot open stops the run before
  testing (`VerdictStoreUnavailable`).
- **Saved coverage is bound to the root that recorded it, and the root is
  checked first.** The dry run records its project root as
  `path.join(basePath, '.')`, the prefix of every file name `mutantIdOf` hashes,
  inside the coverage record it persists, so every writer (end-of-run report,
  checkpoint, dry-run-only report) carries it. Before any digest comparison,
  and even on a forced run, the `dryRunReuse` workflow refuses coverage
  recorded under another root with `rootChanged` and coverage that records no
  root with `rootUnrecorded`; either refusal runs a full dry run that records
  the current root. The root is compared as spelled, never as its real path:
  one directory reached through a symlink and through its real path yields two
  sets of mutant ids, so a real-path match would reuse coverage that matches no
  current mutant and score every mutant NoCoverage. A relative base path keeps
  its relative root, so it and its absolute spelling are two roots too. Gate:
  the integration feature "Running mutation testing through the API on one
  project whose base path is spelled two ways", where a run after either
  other spelling must score as a fresh run. The root comes only from the
  coverage record, never from
  the report header: `unionIncrementalReports` takes a merged report's header
  from the first shard but its coverage from the first shard that has one, so
  a header fallback admits another root's coverage. The `dryRunCandidates`
  workflow keeps the incremental file's coverage only when its recorded root
  is the current root, and the closure inputs, the reused prior, the
  planner's dry-run cost, and the flaky mutant ids all come from the kept
  coverage.
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
  checker configuration changed, closure changed, a flaky dependency, a
  timeout that has not reproduced, an unreadable entry, an unavailable store,
  or no prior record - and the run's `reuse` line partitions reused, ran, and
  refused so the split is auditable.
- **A closure opens only on a dynamic specifier.** Workspace links are followed
  and their sources hashed; an installed file the runner reports (a setup file)
  is a content-hashed leaf whose imports are not followed, because the
  lockfile and manifest digest covers `node_modules`. A bare specifier resolves
  as Node resolves it: from the importing file's real directory upwards,
  nearest `node_modules` first, so a linked package's own dependencies are
  external rather than unresolved. The closure's test set is
  the configured test files plus every test file the dry run observed, so a
  runner-discovered test cannot leave its closure unhashed. Gate:
  `pnpm --filter @systemfsoftware/stryker-js exec vitest run tests/import-closure.integration.test.ts tests/incremental-reuse.integration.test.ts`
  fails when an installed setup file, a workspace import, a linked package's
  own dependency, or an observed-only test file opens a closure or goes
  unhashed.
- **Only reproducible verdicts are cached.** A wall-clock Timeout is reused
  only after it reproduces; a hit-limit Timeout is reused on first sight.
- **The engine is identified by its installed files, not by a declaration.**
  The engine digest hashes the manifest and every file under the paths the
  `files` field declares, for `@systemfsoftware/stryker-js` and the runner it
  depends on, as resolved at run time. Any rebuild that changes a shipped byte
  refuses every verdict the previous build wrote (`semanticsChanged`); a
  declared path missing on disk refuses the run instead of hashing less. No
  human has to remember that a release altered what a status means.

```text
key(mutant) = sha256(
  contentId(mutant),
  closureDigest(coveringTests(mutant)), coveringTestIds(mutant),
                                               # CompileError: programDigest instead
  runInputsDigest(options minus scope minus presentation minus environment),
  checkerConfigDigest(checkers),
  engineDigest(installed files of the engine and its runner),
  mutantSetPolicy,
)
reuse(mutant) = newest readable entry with the same key, else refuse(named reason)
```

## Verification

- Run an unchanged project twice: the second run reuses every verdict and
  reports zero refusals. A refusal count above zero on an unchanged tree is the
  false-miss signature.
- Point a second machine, shard, or pull request that checks the project out
  at the same absolute path at the same store, or copy the store directory
  elsewhere and point `verdictStore` at the copy: the verdicts are still
  reused, proving the key names no store location or shard. A checkout at
  another absolute path reuses nothing, because the key carries the absolute
  file path.
  The e2e journeys `verdict-store-reuse` (an unchanged re-run on a fresh
  machine against a shared S3 bucket reuses at least 95%, read from the run's
  own `reuse` line) and `verdict-store-concurrency` (a shard SIGKILLed
  mid-write leaves no unreadable entry, and the next run reuses exactly what
  was stored) hold this on the packed CLI.
- Restore a report written under root A into root B and run there: the run
  refuses with `rootChanged`, names both roots, runs its own dry run, and the
  next run under B reuses. A mutant scored `NoCoverage` right after a logged
  coverage reuse is the cross-root signature.
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
  cache key that strings a report path or a tool version; a reuse decision
  that reads a report header field instead of the record it is deciding about.
