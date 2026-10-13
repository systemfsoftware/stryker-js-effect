---
title: Find the contract law's version commit in one fetch from a treeless clone - Plan
type: fix
date: 2026-10-13
topic: contract-law-treeless-history
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan
execution: code
supersedes: docs/plans/2026-10-13-1946-fix-contract-law-treeless-history-plan.md
---

# Find the contract law's version commit in one fetch from a treeless clone - Plan

This plan supersedes plan 1946. PR #349 implemented 1946 at `27e170749`, and its full-path review (run `20261013-201147-956b156e`) changed three parts of the contract:

- KD1: one shared reader step, so the counted scenario grades the call `readWorkspace` makes;
- KD2: a stricter probe, plus a full-clone assertion that can fail;
- U1: a fixture whose manifest changes after the release, with rows that compare commit counts.
  Everything else stands as written in 1946.

## Goal Capsule

`main` is red at `02bd69908`. In CI run `38445827562`, the `check` job failed because one case in `@systemfsoftware/stryker-js-cli-contract`, `tests/contract-version-law.integration.test.ts` > "The committed contract documents keep every ground the released ones hold", ran past its 30,000 ms budget (30,073 ms).

The case looks up the released version commit by walking `main`'s first-parent history. CI's checkout has the commits of that history but none of their trees, so the walk fetches the trees it needs from GitHub one round trip at a time, about one per commit. Every merge to `main` adds a round trip until the next release.

After this fix, the walk takes one round trip whatever the history length. The law still decides the same thing, the timeout is unchanged, and nothing is retried or skipped. The fix is one small PR off `main`, and the test is the only file it changes.

Review status: written for root review. No branch and no code exist yet.

## Product Contract

### Requirements

- R1. **Same law.** The released baseline is still the newest first-parent commit on the merge-base with `origin/main` whose `package.json` sets `main`'s version (`contract-version-law.integration.test.ts:165-192`, `docs/solutions/tooling-decisions/contract-law-reads-its-baseline-from-the-version-commit.md:38`). Every existing scenario keeps its name, its steps and its expected result:
  - the 32 cases of the file, including "A shallow checkout that cannot see the parent of the version commit refuses as truncated history" (`:996`) and "A version commit that is the root of a full history is the released baseline" (`:1028`);
  - the real-workspace case, which stays live against the repository's own history.
- R2. **One round trip.** In a partial clone that has `main`'s commits but not their trees, finding the version commit costs one fetch from the promisor remote, however many first-parent commits separate the version commit from the base. A full clone fetches nothing; today it fetches nothing either.
- R3. **No budget games.** The 30,000 ms test timeout, CI's fetch filter (`ci.yml:48`, `ci.yml:84`), retries and skips are all unchanged. `.github/workflows/` stays untouched.
- R4. **Failing first.** A new committed scenario counts the fetches the reader makes against a local `file://` origin with N first-parent commits after the version commit. It fails on today's reader with N fetches (12 for N = 12) and passes after the fix with 1. It counts round trips, not milliseconds, so it holds on a slow or loaded runner, and it needs no network.
- R5. **Green on the exact head.** The PR's `check` runs the case in CI's real clone shape and passes.

### Out of scope

- The CI fetch step. It is named "Commit graph of main for repo-checks" (`ci.yml:45`, `ci.yml:81`) and fetches commits only on purpose.
- The law's decision code, the contract documents and the changeset reader.
- T8 (the 400-line cap), which starts after this PR is reviewed and green.

## Evidence (measured 2026-10-13)

### CI runs

| State                                  | CI run                                       | Case in CI                                                                                                               |
| -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| green `main` `b4db6d8ed`               | `38421349593` (`workflow_dispatch`, success) | not printed: the `test` task logs errors only (`turbo.json` `outputLogs: errors-only`), and no Turbo summary is uploaded |
| PR #339 `bfd245a6f` (base `efd199625`) | `38436787105` (pull_request, success)        | executed (#339 changed the package) and passed, so under 30,000 ms; time not printed                                     |
| red `main` `02bd69908`                 | `38445827562` (push, failure)                | 30,073 ms, timed out; its 31 siblings took 0.2-6.2 s                                                                     |

### The walk in CI's clone shape

Each state was cloned fresh as `git clone --filter=tree:0` of `main`, then the commit was fetched and checked out (git 2.56). The command is the reader's own pickaxe, and lazy fetches were counted from `GIT_TRACE2_EVENT` `child_start` events:

| State               | First-parent commits back to version commit `9e81669b8` | Lazy fetches | `cli-contract` pickaxe                        |
| ------------------- | ------------------------------------------------------- | ------------ | --------------------------------------------- |
| green `b4db6d8ed`   | 32                                                      | 35           | 12,658 ms                                     |
| PR base `efd199625` | 36                                                      | 39           | 14,731 ms                                     |
| red `02bd69908`     | 40                                                      | 43           | 38,378 ms (15,116 ms on a second fresh clone) |

- The `plugin-interface` walk that follows costs 233-320 ms and 1 fetch, because it reuses the trees the first walk fetched.
- I ran the real case in a CI-shaped clone of red `main`. It timed out after 31 lazy fetches, all made by that one `git log`, which ran 11.72 s across 169 git processes. Every other read (`show`, `cat-file -e`, `ls-tree`, `merge-base`, `rev-parse`) took ≤0.02 s and fetched nothing.
- In a full clone the same case takes 241 ms (green, run alone) and 950 ms (red, two files in parallel).

### Second failing run

#319's `check` (run `38451521025`, job `115485450431`, head `0f1350fce`) timed out on the same case at 30,065 ms. Its checkout has the same shape:

- a `--depth=1` fetch of merge commit `9aa3703` (#319 into `main` at `a83d1b32e`), then `git fetch --no-tags --filter=tree:0 --unshallow origin main` (job log line 973);
- git 2.55.0.

### Cost against history, all states

Fresh treeless clones, the `cli-contract` pickaxe:

| Base                      | First-parent commits walked | Lazy fetches | Pickaxe   |
| ------------------------- | --------------------------- | ------------ | --------- |
| `b4db6d8ed` (green)       | 32                          | 35           | 12,658 ms |
| `efd199625` (#339's base) | 36                          | 39           | 14,731 ms |
| `02bd69908` (red)         | 40                          | 43           | 38,378 ms |
| `a83d1b32e` (#319's base) | 41                          | 44           | 16,623 ms |
| `b4b91f0aa` (`main` now)  | 44                          | 47           | 19,849 ms |

- **Fetches are exactly the commits walked plus 3**, on every row.
- **Time per fetch varies with the network** (0.36-0.95 s), so the time column is noisy. The fetch count is not.

### Ruled out

- **Document count:** 3 + 1 released documents at every state, all from version commit `9e81669b8`.
- **Changeset ledger and pending changesets.**
  - The ledger path runs no git. `readPendingIntents` (`contract-version-law.integration.test.ts:210-229`) reads `.changeset/*.md` and `ledger.yaml` from disk. `pendingIntentsOf` (`tests/__fixtures__/changeset-intents.fixture.ts:97-107`) parses the ledger's YAML once and each unconsumed file's front matter once.
  - Measured with a throwaway probe of the same functions: 31 changeset files at `b4db6d8ed` take 30.0 ms, and 49 at `b4b91f0aa` take 41.7 ms. The ledger is identical at both (24,475 bytes, 133 packages, 201 intent stems), and no file is listed in it.
  - The cost scales with pending changesets at about 0.65 ms per file, 3 to 4 orders of magnitude below the 30 s budget.
- **Git command count.** The whole live case, traced in full clones at `b4db6d8ed` and `b4b91f0aa`, spawns 38 git processes at each, with identical per-kind counts: `cat-file -e` 8, `log --first-parent` 4, `ls-tree` 4, `merge-base` 2, `show` 20. It makes 0 lazy fetches and takes 277 ms and 200 ms. Nothing runs git per changeset.
- **#339 (`91cc531cc`) and #328 (`ca2f062fa`).** Neither changes the test, its fixtures, the version commit or the released documents.
  - #339 adds 2 changesets.
  - #328 adds 10 changesets, deletes 1, and adds 9 lines to the committed `span-taxonomy.json`.
  - Each adds one first-parent commit to `main`, which means one more lazy fetch in CI's clone. That is their only effect on the case's cost.

## Options compared

All options were measured on a fresh treeless clone of red `main` `02bd69908`, for the `cli-contract` lookup.

| Option                                                                                      | Change                                                                                                                                                                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                                                            | Verdict                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. The reader prefetches the walked trees in one request                                    | In a partial clone, before the version-commit walks, the reader lists the root tree of every first-parent commit of the base (`git log --first-parent --format=%T <base>`, commits only, nothing fetched). It then requests them in one `git fetch --no-tags --no-write-fetch-head --filter=blob:none <promisor> <trees>`. | 1 fetch of 274 root trees with their subtrees: 597 ms, 4.5 MB of packs. The pickaxe then takes 584 ms with 2 blob fetches and finds the same commit `9e81669b8`. Total 1,188 ms, against 15,116 ms with 43 fetches. Offline `file://` origin: N = 6/12/24 commits gives 1/1/1 round trips, against 6/12/24 today. | **Chosen.** It changes only the file that owns the requirement and needs no workflow edit. The fetch stays one round trip as history grows.                                                                                    |
| B. Find candidates by commit message (`chore(release): version packages`), then verify each | Commits only, no trees                                                                                                                                                                                                                                                                                                     | It would miss a version set by any other commit, which changes the law (#302)                                                                                                                                                                                                                                     | Rejected (R1)                                                                                                                                                                                                                  |
| C. `ci.yml` fetches `main` with `--filter=blob:none` instead of `tree:0`                    | One line at `ci.yml:84` (and `:48`)                                                                                                                                                                                                                                                                                        | 489 ms, 2 blob fetches                                                                                                                                                                                                                                                                                            | Rejected for this PR: `.github/workflows/` is read-only for this stream (`AGENTS.md:7`, CONST-E9), and the step fetches commits only on purpose for repo-checks. The test would also stay slow in any other treeless checkout. |
| D. Raise the case timeout, retry it, or mark it non-live                                    | none                                                                                                                                                                                                                                                                                                                       | It hides the linear growth, and the next merges cross any new budget                                                                                                                                                                                                                                              | Rejected (R3)                                                                                                                                                                                                                  |

## Key decisions

- **KD1. One reader step, `readMainBaseWithTrees`, reads the merge base and then prefetches.** `readWorkspace` (`:269-297`) and `pickVersionCommit` (`:439-445`) both call it, so the counted scenario, which runs through `pickVersionCommit`, grades the same function `readWorkspace` uses. It runs once per run, before the per-package loop, so one request covers both packages' walks.
- **KD2. A missing tree, not a config key, decides whether to prefetch.** The reader probes the root tree of the oldest first-parent commit it can see with `git --no-lazy-fetch cat-file -e <tree>`, which never fetches.
  - Exit 0: the trees are local (a full or shallow clone), and nothing is fetched.
  - Exit 1 with empty stderr: the object is missing, so the reader prefetches from `origin`, the remote it already reads `main` from (`MAIN_REF`, `:57`).
  - Any other exit (for example 129 for an unsupported option) dies with git's stderr, like every other git read.
  - Measured: a missing object exits 1 with 0 bytes of stderr, a bad option exits 129 with usage text, the treeless clone's oldest tree exits 1, and the full worktree's exits 0.
  - **Why the check is load-bearing:** a filtered fetch in a full clone transfers nothing, but registers `origin` as a promisor remote (`remote.origin.promisor true`, `remote.origin.partialclonefilter blob:none`, `core.repositoryformatversion 1`). An always-prefetch reader would turn a developer's full clone into a partial clone.
  - Rejected detection: `extensions.partialClone`. A `git clone --filter=tree:0` carries `remote.origin.promisor true` but no `extensions.partialclone`.
  - `--no-lazy-fetch` needs git 2.44 or later. CI runs git 2.55.0 (`check` log of run `38445827562`, checkout step).
- **KD3. A failed prefetch fails the case like any other git read** (`gitOutput`, `:124-131`), with the remote's stderr. It is not retried, and the walk does not fall back to lazy fetching.
- **KD4. The fetch is bounded by first-parent history, not the whole repository.** It requests only root trees, plus their subtrees through `--filter=blob:none`. Blobs still arrive lazily, and only for the manifests the pickaxe compares. 274 tree ids are about 11 KB of arguments, far under the argument limit.

## Implementation units

One commit, one PR off `main`, under `fix(stryker-js-cli-contract)`.

### U1. Failing first: count the reader's round trips

- **Test file:** `packages/stryker-js-cli-contract/tests/contract-version-law.integration.test.ts`.
- **New scenario outline:** "Finding the version commit costs the same round trips however long main ran since the release", with `{ live: 'spawns real git against a local origin' }`.
- **Given** an origin repository built with the file's own `releasedRepository` (`1.1.0`, then `1.2.0`, then a notes commit). `commitsAfterTheRelease` then adds N commits; the second of them rewrites the scratch manifest and keeps version 1.2.0. The origin sets `uploadpack.allowFilter` and `uploadpack.allowAnySHA1InWant`.
- **And** a clone in the row's shape over `file://`, whose `remote.origin.uploadpack` is a wrapper script that appends one line per invocation, then runs `git-upload-pack`. The count is reset after checkout.
- **When** the reader picks the version commit (`pickVersionCommit`).
- **Then** the picked commit equals the origin's commit whose subject is `1.2.0` (read separately), the round trips equal the row's, and the clone's promisor state equals the row's.
- **Rows:**

  | Clone    | N  | Round trips | Promisor remote after |
  | -------- | -- | ----------- | --------------------- |
  | treeless | 6  | 3           | yes                   |
  | treeless | 24 | 3           | yes                   |
  | full     | 24 | 0           | no                    |

- **Observed:**
  - With the fix, the treeless rows cost 1 tree prefetch plus 2 lazy blob fetches (`--filter=blob:none --stdin`) for the manifests the pickaxe compares, the same at 6 and 24 commits (GIT_TRACE2 on a shell replica).
  - On `main`'s reader the replica costs 9 and 27, so both treeless rows are red.
  - The first committed version of this scenario (12 commits, unchanged manifest) failed on `main`'s reader with 13 round trips (`27e170749` work log), then passed with the fix.
  - The full row fails for a reader that always prefetches: its round trips stay 0, but the clone gains a promisor remote.
- **Admission** (`skill://test-layer-selection`): this is a "Known bug report / regression" deterministic test at integration altitude. It spawns real git, which the in-process gate refuses, because the subject is git's own fetch behaviour and no in-process stand-in reproduces lazy fetching. The file already spawns real git in its other `live` scenarios. The root ordered a committed failing-first measurement, and the deviation is declared in the PR body.
- **Cleanup:** temporary directories are removed with `removeRepository`.

### U2. The fix

- Add `isMissingTree` (KD2), `prefetchFirstParentTrees(repositoryRoot, base)` and `readMainBaseWithTrees` (KD1). `prefetchFirstParentTrees` It lists `git log --first-parent --format=%T <base>` (commit objects only, nothing fetched) and checks the last listed tree with `git --no-lazy-fetch cat-file -e` (KD2). If that tree is missing, it runs one `git fetch --no-tags --no-write-fetch-head --filter=blob:none origin <listed trees>` through `gitOutput`. If the tree is present, it does nothing.
- `readWorkspace` and `pickVersionCommit` read the merge base through `readMainBaseWithTrees`.
- Nothing else in the file changes: no decision code, no scenario, no timeout.

### U3. Record

- `docs/solutions/tooling-decisions/contract-law-reads-its-baseline-from-the-version-commit.md`: add one paragraph saying that in a treeless clone the walk is one fetch per commit, so the reader prefetches the first-parent root trees once. Cite this plan's measurements.
- `.changeset/`: one `none` intent for `@systemfsoftware/stryker-js-cli-contract`. Since #335, the changeset gate reads Turbo's `typecheck` graph, which includes tests (precedent: `.changeset/lockfile-scenarios-graded-projects.md`). Nothing published changes.

## Verification contract

Everything runs for the changed package only. There is no local mutation run and no workspace-wide typecheck.

1. **Red before.** The U1 scenario on today's reader fails with 12 round trips. The run is recorded in the PR body, with the reader change stashed.
2. **Green after.** `pnpm --filter @systemfsoftware/stryker-js-cli-contract exec vitest run tests/contract-version-law.integration.test.ts` passes all 35 cases (32 today plus the three rows of U1), with the 30,000 ms timeout unchanged.
3. **CI shape, locally.** In a fresh `--filter=tree:0` clone of the PR head (the `/tmp/p0-cvl` probe), the real-workspace case passes, and its time and fetches are recorded: 1,779 ms, with 1 prefetch plus 4 lazy blob fetches, against a timeout and 45 fetches on `main`'s reader.
4. **Package gates.** For the package only: `typecheck`, `lint`, `lint:tsgo` and the full `test`, plus `dprint check` and the changeset validator.
5. **CI.** `check` is green on the PR's exact head. The body quotes the case's duration from the `check` log if it is printed; it is printed only on failure, so a green `check` that executed the task is the evidence.
6. **Review.** A full report-only `ce-code-review` on the final head, served by a non-Claude model (DeepSeek or MiniMax, no Grok). The served model and every finding's disposition go in the PR body.

## Risks

- **GitHub refuses wants for tree ids.** Measured not to: the probe's one fetch of 274 root trees from `github.com` succeeded, and lazy fetches use the same wants. If GitHub ever stops allowing it, the case fails loudly at the prefetch with the remote's message (KD3), not silently.
- **History growth makes the one fetch bigger.** It grows with first-parent root trees: 4.5 MB for 274 commits today, in one round trip. A future cap would bound the trees to the commits since the last release, not change the shape.
- **Other treeless consumers.** None. On `origin/main` `b4b91f0aa`, `git grep` for git `log` calls in package and test sources finds only this reader (`:169-170`) and `test/bench/src/prepare-side.service.ts:95`. The bench call runs in the Bench workflow, which checks out with `fetch-depth: 0` (`bench.yml:53`), so it is never treeless.

## Gates applied before execution

- **Test admission** (`skill://test-layer-selection`): one regression scenario outline is admitted, with its process-spawn deviation declared in U1. Nothing else is added.
- **Wiki** (`software-wiki`, vector and lexical queries on treeless and partial-clone history walks): no prior entry.
- **Web:** no published recipe for batching a path-limited walk in a treeless clone was found. Git's documented fetch-by-object behaviour is what lazy fetching already relies on. The measured probes above are the primary evidence.
- **Destructive review** (lens: Edge-First, the first cycle on this plan):
  - **Assumption 1: a config key identifies a partial clone.** False: the treeless clone has no `extensions.partialclone`. KD2 now detects a missing tree instead.
  - **Assumption 2: the prefetch is harmless in a full clone.** Unpinned until now: a reader that always prefetched would pass a treeless-only test. U1 now carries a full-clone example that expects 0 round trips.
  - **Assumption 3: no other test walks history in a treeless checkout.** Now checked (see Risks).
  - **Kept:** R1-R5, option A, KD1, KD3 and KD4.

## Load-bearing premises

- P1. `readVersionCommitEvidence` runs `git log --first-parent -1 --format=%H %P -S"version": "<v>" <base> -- <manifest>` (`contract-version-law.integration.test.ts:165-192`, `origin/main` `b4b91f0aa`).
- P2. CI fetches `main` treeless: `git fetch --no-tags --filter=tree:0 $unshallow origin +refs/heads/main:refs/remotes/origin/main` (`ci.yml:84` in `check`, `ci.yml:48` in the docs lane, `origin/main` `b4b91f0aa`).
- P3. The test file is unchanged between `02bd69908` and `b4b91f0aa`; only `ci.yml` gained 2 lines (`git diff --stat`).
- P4. The CI runs and their outcomes are as tabled above: `38421349593`, `38436787105`, `38445827562` and #319's `38451521025` / job `115485450431` (GitHub REST and job logs, read 2026-10-13).
- P5. All lazy fetches in the red case come from the pickaxe (trace above). The offline round-trip counts and the one-fetch prefetch are measured (probes `/tmp/p0-cvl/probe-count.sh`, `/tmp/p0-cvl/probe-fix.sh`).
- P6. [unverified] The PR's `check` log will not print the passing case's time (`outputLogs: errors-only`). The evidence for R5 is the green `check` on a head that changes the package's tests, which forces a Turbo cache miss.
