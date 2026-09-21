---
title: E2E Lane Normalized Oracle and One-Shot Container Substrate - Plan
type: refactor
date: 2026-09-21
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
deepened: 2026-09-21
supersedes: docs/plans/2026-09-21-0500-feat-sota-differential-harness-oracle-plan.md
---

# E2E Lane Normalized Oracle and One-Shot Container Substrate - Plan

## Goal Capsule

- **Objective:** The container E2E lane is deterministic by construction: journeys assert an environment-normalized projection of engine results (exact where the environment cannot move it, folded or banded where it can), executed in one-shot containers against an immutable baked image, with the blessed-baseline machinery and drift gate unchanged in shape.
- **Means:** Rebuild the lane substrate (baked image + `run --rm` + host-side workspace state), fold `Killed`/`Timeout` in the oracle projection per upstream Stryker semantics and rustc normalization lineage, concentrate exact per-family arithmetic in the small slices, and amend the governing requirements.
- **Product authority:** Governs `test/e2e/` substrate and oracle assertion semantics; supersedes the 2026-09-21-0500 plan where the two disagree.
- **Stop conditions:** all four enterprise journeys plus sabotage pass in CI-shaped runs on the new substrate; `pnpm test:oracle`, `pnpm check:oracle-drift` green; the full lane fits the CI 1200s budget; no persistent containers exist anywhere in the harness.

## Product Contract

### Summary

The 2026-09-21-0500 plan shipped the oracle machinery (contract, metamorphic suite, blessed baselines, reconciler, drift gate). Execution proved two flaws: the Killed/Timeout split is load-sensitive at fixture scale (host blessed 72/136; container observed 97/109 and survived 16→18), and the persistent-container substrate has leak and stale-install hang classes. This plan corrects both without touching the machinery's contracts: journeys assert the normalized projection, and the substrate becomes immutable-image + one-shot.

### Requirements

Inherited unchanged from the superseded plan: R1-R4, R6-R12, R14-R17 (metamorphic suite, static derivation, reconciliation mechanics, drift gate, contract, exhaustiveness, triage). Changed:

- **R5'.** Blessed baselines are produced by real engine runs inside the same one-shot container substrate the journeys use; the environment that asserts is the environment that blesses (rustc per-platform-baseline lineage).
- **R13'.** Journey literal blocks assert the environment-normalized projection: exact `compileErrors`, `ignored`, `noCoverage`, `runtimeErrors`, `total`, and a folded `killedOrTimeout` (upstream Stryker semantics: Timeout counts as killed in the mutation score). Small slices (edge, checker) keep exact folded per-family tallies. Lifecycle additionally asserts `survived >= S_MIN` as a documented band (upstream stryker-js e2e precedent: `gte/lte` bands with inline reasons where a dimension cannot be pinned); the raw per-status values remain recorded in the blessed baseline JSON for drift diagnosis but never gate the lifecycle journey. The resilience slice asserts its trap semantics as a band: `timeout >= designed trap count`, with the reason inline.
- **R18.** The container substrate is an immutable image: a Dockerfile bakes the packed workspace tarballs and every fixture's `npm install` at image-build time; each engine invocation is a one-shot `container run --rm` against a fresh host-side workspace directory bind-mounted as `/work`, populated by an atomic copy-then-rename entrypoint. No persistent container, no container cleanup step, no install-at-run-time, no `npm exec`. Engine outputs (reports, event streams) persist on the host bind mount. The runtime binary honors `RUNTIME` (docker in CI, podman locally), matching the existing CI lane contract.
- **R19.** The full `pnpm test:e2e` lane must fit the CI budget of 1200s including image build; journeys run concurrently (folded assertions are contention-immune). If the lane cannot fit, the remedy is shrinking the lifecycle mutate set — never silently weakening assertions.

### Scope Boundaries

- The metamorphic property lane, analyzer, reconciler semantics (ignored-count + unblessed findings), and blessed-baseline schema (raw per-status values) are unchanged.
- No production Stryker changes; the harness stays external verification.
- The sabotage journey stays behavioral (threshold-breach exit code), outside regeneration scope.

## Planning Contract

### Key Technical Decisions

- **KTD8. One-shot baked-image substrate.** See R18; host state is the sole fixture state, so failures are inspectable as ordinary files and `podman/docker logs` output.
- **KTD9. Normalization over environment-suppression.** Where the execution environment legitimately varies (Killed/Timeout boundary, race-sensitive survivors), the oracle folds or bands that dimension rather than fighting the environment (rustc normalization lineage: fold what you cannot pin, keep per-platform baselines only when folding loses the signal — the resilience trap band is that exception).
- **KTD10. Exactness concentrated where determinism is engineered.** Small slices use `timeoutMS` with wide margin (60000, upstream's e2e value) and deterministic fixtures, so folded exact tallies hold; lifecycle asserts completion + stream invariants + the normalized projection + the survived band.

### Assumptions

- `npm install` baked at image-build time yields node_modules valid inside the bind-mounted workspace (build environment == run environment by construction: same image).
- The CI lane's 1200s budget accommodates a fresh image build (~3-6 min) plus concurrent journeys (lifecycle bound ~20 min) — verified in the unit work; if violated, R19's named fallback applies.
- The two observed drifting survivors are fixture race sensitivity, not engine nondeterminism; they are recorded as `fixture-fix` candidates in the triage report, not silently folded.

### Risks

| Risk                                                 | Likelihood | Mitigation                                                                                                                            |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Fold masks a genuine K/T regression in the engine    | Low        | Raw split remains in the baseline JSON and reconciler diagnostics; metamorphic + property lanes assert placement semantics in-process |
| Image build cost on cold CI                          | Medium     | Layer-cached Dockerfile ordering (packs layer above fixture layer); build timed in unit work                                          |
| Bind-mount workspace races under concurrent journeys | Low        | Atomic copy-then-rename entrypoint; unique workspace names per journey                                                                |

## Implementation Units

### U8. One-shot substrate

- **Goal:** Replace the persistent-container harness with the baked-image one-shot model.
- **Requirements:** R18, R19.
- **Files:**
  - `test/e2e/tests/__fixtures__/image/Dockerfile` + `entrypoint.sh` (new)
  - `test/e2e/tests/__fixtures__/container-environment.ts` (rewrite: build-image + prepare workspace + one-shot exec; drop persistent container, copyTarballs, install-in-container)
  - `test/e2e/tests/__fixtures__/container-harness.ts` (adapt to host-dir workspace handles)
- **Verification:** a smoke run of the smallest slice (edge) completes and its reports/mutation.json are readable from the host workspace dir; `podman ps`/`docker ps` shows zero containers after teardown and after a killed run.

### U9. Normalized oracle projection

- **Goal:** Fold `Killed`+`Timeout` in the projection; lifecycle asserts the projection plus the survived band; resilience asserts the trap band.
- **Requirements:** R13', R14.
- **Files:**
  - `test/e2e/scripts/oracle/normalize.ts` (new — pure fold functions + `S_MIN` band derivation)
  - `test/e2e/scripts/oracle/normalize.test.ts` (new — unit layer: pure functions, no process)
  - `test/e2e/scripts/oracle/literal-block.ts` (render normalized projection)
  - `test/e2e/scripts/reconcile-oracle.ts` (check mode compares normalized blocks; unchanged semantics otherwise)
  - `test/e2e/tests/enterprise-*.e2e.test.ts` (assertion updates)
- **Verification:** `pnpm test:oracle` green including normalize unit tests; `check:oracle-drift` zero-diff green after reconciliation.

### U10. Re-bless and journey verification on the new substrate

- **Goal:** All slices blessed on the new substrate (flake gate 2/2), all journeys green, lane timed against the CI budget.
- **Requirements:** R5', R19.
- **Files:** `test/e2e/oracle-baselines/*.json` (regenerated), fixture stryker configs (`timeoutMS` 60000 on lifecycle/edge/checker; resilience keeps its trap budget; fixture vitest parallelism restored).
- **Verification:** all four journeys + sabotage pass; `pnpm test:e2e` wall time measured and recorded in the triage report vs the 1200s budget.

### Verification contract

- START-1..6 unchanged (format, typecheck, test, check:ci, changeset, dogfood catalog).
- OBS-1: any journey failure diagnosis goes through emitted event streams and telemetry, never ad-hoc logging.
- U8 smoke evidence (zero residual containers) is required before U10 blessing begins.
