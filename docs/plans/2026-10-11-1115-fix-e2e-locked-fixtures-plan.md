---
title: E2E Fixtures Install From Committed Locks - Plan
type: fix
date: 2026-10-11
topic: e2e-locked-fixtures
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# E2E Fixtures Install From Committed Locks - Plan

## Goal Capsule

- **Objective:** An upstream npm publish can no longer stall or change the e2e lane. Every run bakes the same fixture dependency trees until someone commits new locks, so main's e2e goes green and main merges can resume.
- **Means:** each fixture installs with one `npm ci` from a committed `package-lock.json`, and one script regenerates those locks.
- **Product authority:** the root P0 of 2026-10-11, which supplied done items (a)-(f) and the four questions answered in Appendix A. The branch is `fix/e2e-locked-fixtures`, cut from `main` at `84052beb4` and not based on `ci/e2e-postsubmit`.
- **Open blockers:** none.

## Product Contract

### Summary

The bake stops resolving dependencies. The harness stages each fixture with a committed lock and the packed workspace closure, and the guest runs one `npm ci` per fixture. A new upstream release can reach a fixture only through a regenerated, committed lock.

### Problem Frame

Every e2e run that started after 10:04Z on 2026-10-11 fails in global setup. The stalled job 114447960356 (run 38127840866) logs `[bake] calc-fixture: npm install the workspace closure tarballs`, then `Terminated`, then `... did not finish within 300s`, and fails with `ExitFailure: bake every fixture in the preparation microVM: exited 143`. The registry install that runs before it finished.

The packed `@systemfsoftware/stryker-js` depends on `@effect/platform-node: ^4.0.0`. That range admits 4.0.3, which declares the peer `effect@^4.0.3`, while effect's newest release is still 4.0.2. `--min-release-age=1` only held 4.0.3 back until it was a day old (Appendix A, answer 1). An age gate delays the next half-published release by a day and does not stop it. Removing resolution from the bake does.

### Key Decisions

- **The bake installs from committed locks with `npm ci`; it does not resolve.** (session-settled: user-directed, chosen over the age gate, `--before`, registry-snapshot pins, budgets, kill caps and retries, because each of those leaves resolution in the bake.) Governs R1, R2.
- **Committed locks keep the closure entries but drop their integrity.** npm records a sha512 for each `file:` tarball. With an empty cache, which is the guest's state, any source change in a packed package then fails `npm ci` with `EINTEGRITY`. With a warm cache, `npm ci` silently installs the stale bytes instead (Appendix A, answer 2). Governs R4.
- **At bake time the harness rewrites the closure entries' `version` and dependency fields from the freshly packed manifests.** Without that rewrite, a release that bumps versions makes `npm ci` fetch closure names from the registry, and a closure package that adds a dependency installs without it and fails only at run time. With the rewrite, version bumps install cleanly and a new dependency fails `npm ci` with its own "Missing: … from lock file" error (Appendix A, answer 2). This takes `overlayOf` and `committableLockOf` from closed #285. Governs R4, R6.
- **Closure tarballs are packed under version-free file names.** The fixture's root manifest names each closure package as `file:../../packs/<name>.tgz`. With versioned file names, every release would change those specs and drift every lock. Governs R5.
- **Regeneration starts from the committed lock.** `npm install --package-lock-only` keeps every locked version that still satisfies its range, so regeneration does not pull in releases. #285's seven locks (`@effect/*` all at 4.0.0) seed the first run, and npm keeps a locked version when the manifest's spec widens from `4.0.0` to `^4.0.0` (Appendix A, answer 2). Governs R3, R7.
- **Locks are regenerated on the host and installed in the musl guest.** npm records every platform variant of a native optional dependency, so one lock serves both: #285's calc lock lists `@oxc-parser/binding-linux-x64-gnu` (`libc=glibc`) next to `-musl` (`libc=musl`), and the same for `@rolldown` and `lightningcss`. Governs R7.

### Requirements

**Install**

- R1. Each fixture installs with exactly one `npm ci` from its committed `test/e2e/testResources/<fixture>/package-lock.json`. There is no `timeout`, per-install budget or whole-bake budget.
- R2. `--min-release-age` and the second install are gone from the bake (Appendix A, answer 4).

**Determinism**

- R3. Every committed lock resolves `effect`, `@effect/platform-node`, `@effect/platform-node-shared` and `@effect/opentelemetry` to the versions `pnpm-lock.yaml` pins, which are 4.0.0 at `pnpm-lock.yaml:1989`, `:2021`, `:2027` and `:3861`. The PR shows this per lock with command output.
- R4. Committed locks carry no `integrity` and no `version` on closure (`file:`) entries. The harness writes each closure entry's `version`, `dependencies`, `peerDependencies`, `peerDependenciesMeta` and `optionalDependencies` from the packed manifest before `npm ci`.
- R5. The harness packs each closure package to `<packs>/<name>.tgz` with no version in the file name. The staged root manifest lists the whole closure, aliases included, as `file:../../packs/<name>.tgz` devDependencies, so the paths match in the guest (`/baked/<id>`, `/packs`) and in the regeneration staging.

**Drift**

- R6. A drifted or missing lock fails the bake with npm ci's own output unchanged, plus one line that names the regeneration command. The bake's exit code is npm ci's exit code (Appendix A, answer 3).
- R7. One script regenerates every fixture's lock: `pnpm --filter @systemfsoftware/stryker-e2e fixtures:lock`. It stages fixtures the way the bake does, runs `npm install --package-lock-only --ignore-scripts` over the committed lock, and writes the result back with R4's fields stripped.

**Proof and size**

- R8. All five e2e legs pass on the PR head under main's PR CI, which still runs e2e from `ci.yml`.
- R9. About 250 hand-written lines or fewer, excluding the generated lockfiles (Appendix B).

### Acceptance Examples

- AE1. **Covers R1, R3.** A new `@effect/platform-node` is published while the committed locks are unchanged. The bake installs 4.0.0 and never asks the registry for a version list.
- AE2. **Covers R4.** A PR edits source in `packages/stryker-js` without regenerating any lock. Every fixture bakes with no `EINTEGRITY`.
- AE3. **Covers R4, R5.** A release PR bumps every closure package's version without regenerating any lock. Every fixture bakes.
- AE4. **Covers R6.** A closure package adds a registry dependency and the locks are not regenerated. The bake fails with npm ci's `Missing: <dep>@<version> from lock file`, then the regeneration line, and exits with npm ci's code.
- AE5. **Covers R6.** A fixture's lock is deleted. The bake fails with npm ci's `EUSAGE` error and the regeneration line.

### Scope Boundaries

- Out: the bench lane's enterprise install (`test/bench/src/prepare-side.service.ts:495-504`), which pins with `--before`, and `ClosureInstall.specs`, which the bench still reads.
- Out, by contract: registry-snapshot pins, `--before`, npm wire schemas, bake reports, budgets, new or raised kill caps, retry loops, and any `ci.yml` change.
- `ci/e2e-postsubmit` also edits `bake-fixtures.sh` (deleting the timeout) and `test/e2e/README.md:14`. When it resumes, it merges `main` and takes this branch's version of both.

### Outstanding Questions

**Deferred to Planning**

- Tests: the test-layer gate admits one at most, a colocated property test of the pure overlay-and-strip decision in `test/e2e-core`, if R9's budget allows it. It refuses new e2e journeys and harness integration tests; AE1-AE5 are proven by runs and scratch probes.
- How the script runs the harness's TypeScript: `node` type stripping, as `seed-status-fault` does, or `tsx --conditions=@systemfsoftware/source`, as #285's script did.

### Appendix A. Answers to the four questions

1. **The edge that stalls.** It is the closure tarballs' `@effect/*` ranges, not a fixture manifest.
   - The packed `stryker-js` lists `"@effect/platform-node": "^4.0.0"` (and the same range for `platform-node-shared` and `opentelemetry`). Source: `packages/stryker-js/package.json:39-41`, where `catalog:` resolves through `pnpm-workspace.yaml:14,15,17`. The released 19.0.0 tarball's `package.json` shows the `^4.0.0` that pnpm pack writes.
   - calc-fixture's own spec (`test/e2e/testResources/calc-fixture/package.json:7`, `"effect": "catalog:"` → `pnpm-workspace.yaml:56` `^4.0.0`) installs effect 4.0.2, the latest.
   - `npm view @effect/platform-node@4.0.3 peerDependencies` gives `effect: ^4.0.3`. 4.0.3 was published at 2026-10-10T10:04:06.183Z.
   - Reproduced in a scratch dir: registry-install `effect@^4.0.0` (4.0.2), then `npm install --min-release-age=1 ../dep-1.0.0.tgz`, where `dep` depends on `@effect/platform-node ^4.0.0`. It printed nothing, ignored SIGTERM, and was killed at 125 s (exit 137).
   - The same two edges declared at the root fail in 2 s instead: `ERESOLVE … Could not resolve dependency: peer effect@"^4.0.3" from @effect/platform-node@4.0.3`. Only the transitive placement through a tarball hangs.
   - The 09:34Z run passed because 4.0.3 was 23 h 30 m old, inside the one-day gate.
2. **Closure tarballs.** #285 stripped `integrity` and `version` from `file:` entries when committing (`committableLockOf`, `test/e2e-core/src/npm-wire.schema.ts:167-168` on `origin/fix/hermetic-e2e-bake`). At bake time it restored `version` and the dependency fields from the packed manifests (`overlayOf`, `:223-230`; commit 486536723 "bake installs the lock check validated, closure versions restored"). It packed to `packs/%s.tgz`. Scratch probes with npm 11.19.0, two packed packages `a` → `b`:

   | Committed lock                             | Change since the lock was written           | `npm ci`                                                                   |
   | ------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------- |
   | as npm wrote it (with integrity)           | source change, empty cache                  | `EINTEGRITY`, exit 1                                                       |
   | as npm wrote it                            | source change, warm cache                   | exit 0, but installs the stale cached bytes (`index.js` v1, version 1.0.0) |
   | integrity stripped, versions kept          | version bump plus a new registry dependency | exit 0; the new dependency is silently absent                              |
   | integrity and version stripped, no overlay | version bump                                | `ENOTCACHED`: it fetches closure names from the registry                   |
   | stripped, overlay applied                  | version bump                                | exit 0                                                                     |
   | stripped, overlay applied                  | member adds a registry dependency           | `EUSAGE … Missing: left-pad@1.3.0 from lock file`                          |
   | none                                       | lock missing                                | `EUSAGE`                                                                   |

   Committed full locks fit the budget once R4 and R5 hold. They pin the whole tree, closure members' third-party dependencies included. They leave open only what a regeneration resolves for an edge the committed lock does not already satisfy. #285 ran this design (one `npm ci` per fixture plus the overlay, commits 43cc5a498 and 486536723) with all five e2e legs green in CI: run 38089587997 at 542e353ff, and again in run 38124123027 at 630413948.
   - **Rejected: third-party-only locks with the tarballs installed by path.** This needs a second `npm install <tarballs>` after `npm ci`. That install resolves again, and that resolution is today's stall; it also breaks (b). It pins the third-party tree only until the tarball install and leaves every edge the closure adds open.
   - **Rejected: npm's lock committed as written.** It fails with `EINTEGRITY` on every PR that touches a closure package, or installs stale bytes from a warm cache.
3. **(d)'s line.** Neither npm's output nor its exit code is wrapped or captured:

   ```sh
   npm ci --no-audit --no-fund --loglevel=error || {
     status=$?
     echo "[bake] $id: npm ci exited $status; if package-lock.json drifted or is missing, run pnpm --filter @systemfsoftware/stryker-e2e fixtures:lock and commit the result" >&2
     exit "$status"
   }
   ```

   npm writes straight to the job's stderr. The line comes last, and global setup reports the last 4000 stderr characters (`test/e2e/src/Harness/guest-job.service.ts:33`, `:74`), so the report always includes it.
4. **Deleted bake lines.**
   - `test/e2e/tests/__fixtures__/bake-fixtures.sh:4-5`: `INSTALL_LIMIT_SECONDS`, `KILL_AFTER_SECONDS`.
   - `bake-fixtures.sh:7-19`: `install()`, with its `timeout`, `--min-release-age=1` and overrun message.
   - `bake-fixtures.sh:24-25`: the two installs, replaced by the `npm ci` in answer 3.
   - `test/e2e/src/Harness/fixture-cache.service.ts:698`: the closure specs passed as the bake script's arguments.
   - `fixture-cache.service.ts:114-115` and `:416-453`: the versioned tarball-name lookup, replaced by version-free names; `--pack-destination` at `:504` becomes `--out`.
   - `test/e2e/README.md:14`: the age-gate and timeout paragraph.
   - Docs that describe the two installs: `docs/solutions/build-errors/e2e-lane-packed-a-subset-of-its-workspace-closure.md:68-69` and `docs/solutions/build-errors/e2e-bake-resolved-an-npm-alias-edge-from-the-registry.md:60`.

### Appendix B. Hand-written line budget

| Change                                                                                                                                                                  | Added (approx.)                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `bake-fixtures.sh` (26 lines become about 12)                                                                                                                           | 8                                |
| Pure lock overlay and strip, with a minimal lock-entry schema (`test/e2e-core`)                                                                                         | 45                               |
| `ClosureInstall.dependencies` (name to `file:` spec) next to `specs`                                                                                                    | 10                               |
| `fixture-cache.service.ts`: version-free packing, closure devDependencies in the staged root manifest, overlay on the staged lock, a staging entry point for the script | 60                               |
| `test/e2e/scripts/lock-fixtures.ts` and its `package.json` script                                                                                                       | 75                               |
| README and solutions docs                                                                                                                                               | 10                               |
| **Total**                                                                                                                                                               | **about 210** (about 70 removed) |

The seven regenerated `package-lock.json` files are generated and not counted.
