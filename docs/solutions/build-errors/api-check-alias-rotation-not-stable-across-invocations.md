---
title: api:check fails on a clean tree because api-extractor's alias rotation is not stable across invocations
date: 2026-09-19
category: build-errors
module: stryker-js-family
problem_type: build_error
component: tooling
severity: medium
framework_version: api-extractor 7.59.1
symptoms:
  - "`api-extractor run` exits 1 with `Warning: You have changed the API signature for this project` on a tree whose committed api report was regenerated moments earlier by `api-extractor run --local`"
  - "The generated report and the committed report differ only in which of two imports carries the `_2` suffix"
  - "`api:check` fails on one run and passes on the next with no source change in between, and the turbo-driven task can disagree with a direct package-level run on an unchanged tree"
root_cause: config_error
resolution_type: config_change
tags: [api-extractor, api-report, api-check, turbo, alias-rotation, nondeterminism, build-error]
---

# api:check fails on a clean tree because api-extractor's alias rotation is not stable across invocations

## Problem

`api:check` is a merge-blocking gate, and it reports "you have changed the API
signature" on a tree whose committed api report was just regenerated. The
difference it is complaining about is an alias choice, not a signature change, so
the failure reads as a real public-surface break when nothing broke.

## Symptoms

- `api-extractor run` exits 1 with `You have changed the API signature for this
  project. Please copy the file "temp/main/<pkg>.api.md" to
  "etc/<pkg>.api.md"` immediately after `api-extractor run --local` reported
  success.
- The only difference between the two reports is which of two imports of the same
  external module gets suffixed:

  ```text
  < import { Duration } from 'effect/Duration';
  < import * as Duration_2 from 'effect/Duration';
  ---
  > import * as Duration from 'effect/Duration';
  > import { Duration as Duration_2 } from 'effect/Duration';
  ```

  with `connectRetry` and `timeOverhead` following whichever name their import
  was given.
- Repeated `api:check` on an unchanged tree is not stable: one run fails and the
  next two pass.
- The turbo-driven `api:check` task and a direct package-level `api:check` can
  produce different alias orders from the same built declarations.

## What Didn't Work

- Re-running `api:update` (`api-extractor run --local`). It rewrote the
  committed report with one alias order; the following `api:check` regenerated
  the other order and failed again.
- Rebuilding the package first, then running `api:update`. The report was fresh
  and `api:check` still failed on the first run after it.
- Treating it as a real surface change. No exported name, member or type moves;
  both renderings describe the same public API.

## Solution

Hand the committed report the artifact the _failing_ invocation itself
generated, then re-run the gate that owns the check. On the
`bankrupt-subpath-exports` branch the report also carried a genuine change -
the `Node_2` alias collapsing to `Node` after an import retarget onto the
instrumenter package root - so the regeneration was needed anyway:

```bash
pnpm exec turbo --concurrency=${TURBO_CONCURRENCY:-100%} build --filter=<pkg> --force
pnpm check:ci                       # fails; the turbo task wrote temp/main/<pkg>.api.md
cp packages/<pkg>/temp/main/<pkg>.api.md packages/<pkg>/etc/<pkg>.api.md
pnpm check:ci                       # 87/87 green
```

The load-bearing step is copying the artifact produced by the same invocation
mode that failed, not one produced by a different mode. `api:update` and
`api:check` are separate processes with their own alias heuristics, so aligning
against the wrong one merely moves the failure to the next run.

## Why This Works

api-extractor assigns each imported symbol a local name as it walks the rolled
declaration. When two entries in one report need the same identifier it suffixes
one of them `_2`. Which entry receives the suffix depends on encounter order, and
that order is not pinned: it varies between runs over identical input, and
between a direct package-level invocation and the turbo task that runs the same
script. The report body is semantically identical either way, so a mismatch is an
artifact of naming, never of the API.

**Invariant: an artifact gate must be compared against the artifact its own
invocation produces.** A generator whose output is order-dependent cannot be
checked by regenerating with a different driver and diffing the two - the diff
measures the driver, not the contract. Either the generator is made
order-stable, or the comparison is made within one driver:

```text
gate(invocation I) == artifact(I)      -- checkable
gate(invocation I) == artifact(J)      -- measures I vs J, not the contract
```

## Prevention

- When a report-only gate fails with a signature warning, diff the generated
  artifact against the committed one first. A diff confined to `_2` suffix
  placement is naming churn; a diff that moves a declaration is the real thing
  and needs the major bump.
- Regenerate through the entry point the gate uses. After a public-surface
  change, run the full `check:ci` and take the report that run produced rather
  than one from a package-level `api:update`.
- Do not re-run until green and walk away while the two artifacts still differ;
  the next invocation can flip back. Confirm the generated and committed
  artifacts are byte-identical before calling the gate satisfied.
- The durable fix is to pin the alias choice rather than to align artifacts
  afterwards. Nothing in this repo pins api-extractor's alias assignment, so any
  change to a package's import graph can re-roll it - which means this gate can
  fail a pull request whose public surface is untouched.

## Related Issues

- `docs/solutions/build-errors/tsdown-inlines-devdep-types-into-dts-single-copy-rule.md`
  - the same `Node`/`Node_2` alias surface, hit from a consumer's compiler
    rather than from the report gate.
- `docs/solutions/tooling-decisions/workspace-source-condition-dev-resolution.md`
  - how each package's extractor config rolls declarations from built output,
    the input this naming churn varies over.
