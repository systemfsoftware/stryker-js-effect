# Coding Standards

Review criteria for every change in this repository. `packages/ignorers/CODING_STANDARDS.md` adds criteria for its subtree; all governing files apply together, and the org-wide `repos/constitution/CODING_STANDARDS.md` applies with them. Rules a linter, type checker, build or test already enforces are not repeated here.

## Mutant identity and placement

- A mutant is addressed by its id, never by its position in a list. Filtering, ignoring or slicing a plan shifts every later position, so pairing mutants with replacements, verdicts or annotations by index pairs the wrong ones ([directive-ignored mutants shift placed replacements](docs/solutions/runtime-errors/directive-ignored-mutants-shift-placed-replacements.md)).
- A value derived from source text (a mutant's replacement text, a location, a digest) is captured before any later step rewrites that text. Activation placement rewrites the AST, so text read after it describes the placed switch, not the mutant ([replacement text captured before placement](docs/solutions/runtime-errors/mutant-replacement-text-captured-before-placement.md)).
- Printed code keeps the meaning of the code it replaces in every syntactic position it can land in. A mutant switch on a conditional's test re-associates with the enclosing conditional unless it prints parenthesized ([mutant switch in a conditional test](docs/solutions/runtime-errors/mutant-switch-in-a-conditional-test-needs-parens.md)).

## Reuse, caches and incremental runs

- A cache key digests exactly the content that can change the cached answer, and nothing incidental: not a run id, not tarball bytes, not a whole lockfile or a sibling package's manifest when only one project's closure matters. An incidental input causes false misses; a missing one causes stale hits ([verdict cache keyed by content](docs/solutions/tooling-decisions/verdict-cache-content-keyed-reuse.md), [pack bytes are not a cache key](docs/solutions/build-errors/pnpm-pack-tarball-bytes-are-not-a-stable-cache-key.md), [diff scope widened by a sibling manifest](docs/solutions/runtime-errors/diff-scope-widened-by-a-sibling-packages-manifest.md), #303, #382).
- Recorded evidence is reused only under the conditions that recorded it: dry-run coverage under the root that recorded it, a module verdict only when the edit cannot reach the mutant's covering tests (#313, #215, #219).
- A file Stryker writes (reports, streams, checkpoints, emitted JavaScript) never becomes an input of the next run ([checker equivalence emit left .js beside sources](docs/solutions/performance-issues/checker-equivalence-emit-left-js-beside-project-sources.md), #329).
- State a later run reads is written atomically, and a file that fails to decode is discarded with its decode failure named, never half-read (#178, #170, #61).

## Processes, workers and run outcome

- Every wait on another process is bounded and ends in a typed failure that names the process: a worker that never listens, never accepts its socket, misses a pong or ignores SIGTERM fails or is killed, and the run never hangs ([worker boot never listened](docs/solutions/runtime-errors/worker-boot-never-listened-hangs.md), #154, #142).
- A retry re-issues or settles every request that was in flight; it never orphans one ([transient retry orphans in-flight requests](docs/solutions/runtime-errors/worker-rpc-transient-retry-orphans-in-flight-requests.md)).
- The run's outcome reaches every finalizer and the exit code. A scope closed with `Exit.void` hides the outcome, and an exit code computed from signal arithmetic instead of the runtime teardown lies ([stage scope closed with Exit.void](docs/solutions/runtime-errors/stage-scope-closed-with-exit-void-hides-run-outcome.md), [exit codes through runtime teardown](docs/solutions/workflow-issues/exit-codes-through-runtime-teardown.md)).
- A run touches only what it owns: it never removes or breaks another run's sandbox, and it keeps the project it reads read-only (#331, #268).
- A Timeout verdict needs evidence that the mutant ran past its deadline; a deadline starts when the first test begins, and an expiry is confirmed before it is scored (#184, #347).

## Schemas, wire shapes and decoding

- A worker-protocol payload omits an optional key instead of writing `undefined`. `optionalKey` rejects a present-undefined key at decode time in the worker, after typecheck has passed; build optional fields by conditional spread.
- A third-party file (a package manifest, a tsconfig, a lockfile) decodes per entry, tolerating every shape the tool that owns it accepts. A strict optional key in that schema refuses the whole file for one shape Node or tsc accepts ([strict optional key in a third-party manifest](docs/solutions/performance-issues/strict-optional-key-in-a-third-party-manifest-schema-refuses-the-whole-manifest.md), #330, #254, #245).
- A resolution mirrors the tool it predicts: the checker digests the tsconfig `extends` base tsc actually loads, and a resolver follows package exports the way Node does ([checker digest lost to tsconfig extends](docs/solutions/performance-issues/checker-digest-lost-to-tsconfig-extends-through-package-exports.md), #255, #257).
- The machine-stream schema carries no JSON rest records, and a decoder of a JSON map whose keys come from data reads each key exactly and refuses a key no file or id can have, because V8's `JSON.parse` can corrupt such keys (#327, [stream schema rest records](docs/solutions/test-failures/stream-schema-must-not-carry-json-rest-records.md), [V8 JSON.parse key corruption](docs/solutions/test-failures/v8-json-parse-key-corruption-schema-laws.md)).
- A value interpolated into a sandbox profile, a shell line or a path is validated or escaped for that language first ([unescaped cwd in a seatbelt profile](docs/solutions/security-issues/unescaped-cwd-in-a-seatbelt-profile.md)).

## Packages and builds

- A types-only workspace package that a published declaration names sits in `dependencies`, so the emitted `.d.ts` keeps one physical copy of its types ([tsdown inlines devDependency types](docs/solutions/build-errors/tsdown-inlines-devdep-types-into-dts-single-copy-rule.md)).
- A package's vitest config spreads the whole shared config, never only its `test` member, so the suite keeps the `@systemfsoftware/source` condition and grades source instead of a stale `dist` ([narrow spread drops the source condition](docs/solutions/build-errors/vitest-config-narrow-spread-drops-source-condition.md)).
- A package has one tsdown config that owns `package.json#exports` ([a second tsdown config clobbers exports](docs/solutions/build-errors/second-tsdown-config-clobbers-package-exports.md)).
- A job or task that loads a workspace package (a plugin, an ignorer, a bin) builds that package first, in the same job ([mutation plan loaded an unbuilt plugin](docs/solutions/workflow-issues/mutation-plan-loaded-an-unbuilt-workspace-plugin.md), [workspace bin and typecheck ordering](docs/solutions/build-errors/workspace-bin-and-typecheck-ordering.md)).
- A framework or ignorer package declares neither `effect`, `@effect/*` nor any `@systemfsoftware/stryker-js-*` package in any `package.json` dependency block (lint covers source imports, not manifests); its contract is plain objects and functions, so a plugin cannot couple to the host's Effect version.
- A spawned plugin-worker bundle (the vitest runner, the TypeScript checker) keeps its whole runtime closure inlined. Its `deps.onlyImport` names only the project-owned tool it borrows, `vitest` or `typescript`; adding another package there to silence tsdown's error ships a worker that imports from the user's install.

## Tests

- A test proves a timeout, a retry or an ordering with the test clock or a controlled signal, never by sleeping ([do not sleep to prove a mutation timeout](docs/solutions/tooling-decisions/do-not-sleep-to-prove-a-mutation-timeout.md)).
- A fixture's `@stryker-expect` annotations are authored on the formatted source, because commit-time formatting moves the lines an annotation scopes ([annotations on formatted fixture source](docs/solutions/test-failures/annotations-must-be-authored-on-formatted-fixture-source.md)).
- An e2e oracle pins attribution through `killedBy` and location, not through coverage dictionaries ([vm-vitest oracle report contract](docs/solutions/best-practices/vm-vitest-e2e-oracle-report-contract.md)).

## CI jobs

- A job's verdict needs positive evidence that every planned unit ran. An artifact a dead run still leaves behind, an empty count or a missing report is a failure, never a pass ([mutation lane green while every job failed](docs/solutions/workflow-issues/mutation-lane-green-while-every-job-failed.md)).
- Splitting a required job into matrix legs, or renaming it, renames the required status check in the same change ([matrix legs rename the required check](docs/solutions/workflow-issues/matrix-legs-rename-the-required-status-check.md)).

## Breaking changes

- The correct fix lands even when it breaks a caller, a type, a schema or a published API. A shim, deprecation, widened type or bent test kept only to avoid a break is a finding; the break ships with a change intent bumping `major` (`minor` while the package is `0.x`). Wrong: keep `MutantTested.id` as `S.String` because reporters depend on it and widen the test arbitrary to emit prototype keys. Right: tighten `MutantTested.id`, regenerate the API report, bump major.

## Maintaining this file

<!-- ce-standards-bar:start -->

A defect class enters this file only when it appeared in a review finding the author fixed, a fix commit, a cleanup that removed it across the codebase, or a solution record, and no check covers it. State the class as a condition in a few sentences that stay true without naming volatile numbers or symbols, and group rules by area.

<!-- ce-standards-bar:end -->

Retire a rule when a check starts enforcing it, when the code it guarded is gone, or when the team keeps declining findings under it.
