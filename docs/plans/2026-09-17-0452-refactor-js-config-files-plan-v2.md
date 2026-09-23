---
title: JS-only config files and ESM plugin resolution - Plan v2 (corrected contract)
type: refactor
date: 2026-09-17
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
supersedes: docs/plans/2026-09-17-0029-refactor-js-config-files-plan.md
---

# JS-only config files and ESM plugin resolution - Plan v2 (corrected contract)

## Objective

Stryker is configured exclusively by a `.ts`/`.mts`/`.js`/`.mjs` config module.
Every module Stryker loads — configs, `extends` targets, plugins, the vitest
runner's own vitest — resolves and imports through Node's native ESM:
`import.meta.resolve(specifier)` in the consuming module (caller-relative; the
module's URL is the resolution base — Node.js docs, `module.md` §
`import.meta.resolve`), then dynamic `import()` of the returned URL. JSON
configs fail fast with migration guidance. No `createRequire`, `require`, or
`findPackageJSON` ships in product code.

## Authority

Repo constitution > `STRATEGY.md` > this plan. The v1 plan
(`2026-09-17-0029-…`) is superseded wholesale: its KTD3 (`findPackageJSON`
port + entry-selection workflow) was rejected by the repo owner during
implementation and is deleted, port and tests included. Divergence from
upstream stryker's JSON-config support is intentional (v1 KD2, unchanged).

## Requirements

- R1: discovery accepts `stryker.config.{ts,mts,js,mjs}` only; JSON and legacy
  extensions are refused with a named migration target.
  Gate: `pnpm --filter @systemfsoftware/stryker-js-engine test`
  (`config-file.integration.test.ts`).
- R2: bare plugin specifiers resolve caller-relative; path-prefixed plugin
  specifiers are refused; unresolved specifiers warn with the machine-readable
  Node error code; the run fails at prepare only when nothing provides the
  configured runner/checker.
  Gate: `plugin-resolution.integration.test.ts`.
- R3: a plugin that resolves and imports but exports a malformed
  `strykerPlugins` fails the load with the schema error attached (fail-fast).
  Gate: regression scenario "resolves but is malformed stops the run" (red
  before fix, green after — recorded in PR #30 review evidence).
- R4: `extends` cycle detection compares canonical absolute filesystem paths
  (URL and path forms of one file are one key).
  Gate: cycle repro, `config-file.integration.test.ts`.
- R5: config import failures map `ERR_MODULE_NOT_FOUND` /
  `ERR_PACKAGE_PATH_NOT_EXPORTED` to actionable text naming the specifier.
  Gate: `config-file.integration.test.ts` unresolvable-extends scenario.
- R6: gated telemetry — `OTEL_ENABLED=true` exports one `stryker.cli.run`
  span per run (outcome tag, exit code, 1024-char-bounded error text) via a
  single `@effect/opentelemetry` `NodeSdk.layer` with best-effort shutdown;
  the worker process keeps `startWorkerTelemetry`; no host process runs two
  SDKs. Gate: Tempo trace assertion on the failing-run journey.
- R7: supported plugin topology is "resolvable from where Stryker is
  installed" (same project install or same global prefix). The e2e bed
  installs the CLI per fixture. Implementation does not serve fixtures; the
  effect-skew fixture keeps its own bundler resolver.

## Unit Map (all landed; branch `js-config-files`, PR #30)

- U1–U6: as v1 (config reader, engine cutover, runner, fixtures/docs,
  plugin-process split) — landed, then corrected by the rework wave
  (d57f4b8) that deleted the v1 KTD3 artifacts.
- C1: rework onto `import.meta.resolve` (engine, language, plugin-runtime,
  runner) + ignorer-coverage restoration via real workspace ignorer devDeps.
- C2: gated CLI telemetry + bed topology (per-fixture CLI install, `npx`).
- C3: review fixes (schema-error propagation, cycle canonicalization, import
  failure mappings, span-error bound, single-SDK-per-process).

## Verification Contract

- START-1…START-5 green (format, typecheck, test, `check:ci`, changeset gate).
- Container e2e lane: 3 journeys, 10 passed + 1 inherently skipped —
  packed-install closure, live worker RPC, top-level failure contract
  (test-layer gate: e2e stays at ≤4 seam-only journeys; flag matrices live in
  the in-process suites named in R1–R5).
- Tempo carries `stryker.cli.run` with `stryker.run.outcome` /
  `stryker.run.exit_code` for a containerized failing run.

## Outcome

Shipped as PR #30 through commit a25c69c.
