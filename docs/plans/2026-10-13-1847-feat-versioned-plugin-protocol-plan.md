---
title: Versioned Plugin Worker Protocol - Plan
type: feat
date: 2026-10-13
topic: versioned-plugin-protocol
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Versioned Plugin Worker Protocol - Plan

## Goal Capsule

- **Objective:** when a host and a plugin come from different releases, the run either proceeds on one agreed protocol version or stops at once with a typed refusal. A handshaking host names both versions in that refusal; a pre-handshake host meets a closed session, never a hang. A test runner or checker plugin gives the same answers whether it runs inside the host process, in a spawned worker, or behind a network address.
- **Means:** a protocol version per worker group and one handshake on the existing `effect/rpc` wire. A plugin publishes one server definition, which `@systemfsoftware/stryker-js-plugin-runtime` serves at whatever address it is given. The host's public worker client gains three transports (in-process, spawned worker, remote). One integration suite runs unchanged over every transport the test-layer gate admits.
- **Product authority:** the Stream A contract's T2 layer (`.context/stream-a-contract.md`, not committed) and root's binding SOTA brief of 2026-10-13. Done needs main-merged evidence: verdict-lossless behaviour, public-surface integration tests, no internal mocks, and compatibility evidence. T5 (an out-of-tree plugin fixture built from the released tarballs) follows T2 and is not active scope.
- **Not active scope (#346 backlog, kept as follow-ups):** the 16 Service-less `*.service.ts` files, F7 (`MicroVM` error classes in `GuestJobFailure`), the remaining F13 stage bindings, and the three unescalated binding sites.
- **Open blockers:** Q6 must be answered before U5 starts. The contract asks for one suite passing "in-process, worker and remote". The test-layer admission gate refuses an integration test that spawns a process, so the default builds the suite for in-process and remote only. That default narrows the contract's clause and needs root's approval. The other five questions carry defaults this plan takes.

## Product Contract

### Summary

Each worker protocol (test runner, checker, reporter) gets a version number, and one handshake settles it before any work. Plugin authors write their handlers once, as a definition that `plugin-runtime` serves. The host connects to that definition in-process, in a spawned worker, or at a TCP address, through one public client. One suite, run unchanged over each admitted transport, decides whether the protocol holds.

### Problem Frame

The runner and checker already talk over `effect/rpc` (`packages/stryker-js-plugin-interface/src/PluginRpcs.service.ts:100-116`), but nothing on that wire names a version. The redesign plan chose this on purpose: "No contractVersion handshake — the wire Schema decode is the compatibility gate" (`docs/plans/2026-09-16-1241-refactor-plugin-system-redesign-plan.md:46`). It also recorded the cost: an incompatibility "surfaces as a wire decode error — legible but blunter than a version-mismatch message" (`:300`). Today a skewed worker fails by decode error, boot timeout or crash, and nothing says which release to install. The only typed version refusal on the wire belongs to the type-query sub-protocol (`TypeQuery.schema.ts:6,131-137`).

T5 makes this cost real. An out-of-tree plugin built from released tarballs runs against whatever host the user installed, so version skew becomes the normal case. Each plugin also binds its own address: the TypeScript checker reads `STRYKER_SOCKET` and builds its own socket server (`packages/stryker-js-typescript-checker/src/main.ts:21-24`). It reads its run options from a file the host wrote beside it (`packages/stryker-js/src/node-platform.ts:70-78`), so a plugin can only run as a spawned child on the same machine. No test runs one protocol suite over more than one placement.

### Key Decisions

- **One version per protocol, settled by a handshake before any work request.** Governs R1, R2, R3, R14. This supersedes the redesign plan's "No contractVersion handshake" (`:46`), because the Stream A contract requires "a protocol version mismatch is refused with a typed error". It gets ADR-0005 (U7), since ADR-0001 records that contestable choices go in ADRs (`docs/adr/0001-cell-architecture-module-taxonomy.md:18`).
- **Same wire, three placements.** Every transport carries the same NDJSON framing through the same `RpcServer`/`RpcClient` machinery. Transports differ only in where the server runs and how its bytes travel: an in-memory socket, a Unix socket to a spawned child, or TCP. Governs R5, R6, R7. Chosen over a worker-thread in-process transport, which uses structured clone and a second codec.
- **The host is the only source of run options.** Options travel in the handshake, never in a file beside the worker. Governs R4.
- **A plugin publishes its server definition once; `plugin-runtime` owns binding, announcing and the handshake.** The T5 out-of-tree plugin gets the handshake without writing it. This reverses the redesign plan's "the in-process `Layer` contract [is] dropped" (`:48`). In-process now serves the plugin's own definition over the same wire. Governs R5, R6, R8.
- **Transports are chosen through the public library client, not through config or CLI flags.** The engine keeps spawning workers. Governs R9.
- **The suite is a gherkin integration feature, not a `*.conformance.test.ts`.** `@systemfsoftware/conformance-spec` judges concurrent behaviour against a model. Its own skill classes a two-sided parity question as outside that harness (write-conformance-specs A2), and the package is not in the workspace catalog. Governs R10.

### Requirements

**Versioning and refusal**

- R1. Each worker protocol (`TestRunner`, `Checker`, `Reporter`, and any group a caller declares) carries one integer version. A change that a worker built for the previous version cannot serve bumps it (pack: package-topology, surface-changes-are-versioned.md).
- R2. Before any work request, the host completes a handshake in which the worker states its protocol name and version. A mismatch is refused with a typed error carrying the plugin, the protocol, the host's version and the worker's version.
- R3. A worker that predates the handshake is refused with the same typed error, its version shown as "no handshake". It is never timed out, retried or silently skipped (pack: schema-laws, tagged-unions-over-state-by-presence.md).
- R14. A worker that receives any request before the handshake closes the session at once, so a pre-handshake host fails with its existing connection error instead of waiting.
- R4. The host delivers run options in the handshake. No worker reads options from a file the host placed beside it.

**Placement**

- R5. A worker plugin publishes one server definition from its library entry. Importing that entry starts nothing (pack: package-topology, import-time-inertness.md).
- R6. `plugin-runtime` serves a definition at the address it is given (Unix socket path, TCP host and port, or an in-memory socket) and answers the handshake for every definition it serves.
- R7. The host's public worker client connects to a plugin in-process, through a spawned worker, or at a remote address. Every request, response, stream chunk, typed failure and interruption is the same on each.
- R8. A served worker announces the address it bound in one line, in a published format the host client can parse. A caller that asked for port 0 learns the real port.
- R13. A worker serves one host session. A repeated handshake carrying the same session id and options re-admits it after a reconnect. A handshake with another session id is refused with a typed error.
- R9. `stryker run`, `plan`, `serve` and `mcp` keep spawning workers as today. No exit code, report byte, stream event or verdict changes for a configuration whose plugins match the host's protocol version.

**Evidence**

- R10. One protocol suite runs every scenario unchanged against each transport the test-layer gate admits (Q6). It drives real definitions through the published host client and the published `plugin-runtime` server, with no mock, substituted launcher or stubbed socket. The test itself spawns no process (pack: boundary-testing, no-mocks-on-internal-glue.md; pack: boundary-testing, real-system-oracles.md).
- R11. The TypeScript checker and the Vitest runner give identical verdicts over every transport the suite runs, for the same fixture project and mutants. The expected verdicts are authored in the fixture, never taken from a run (pack: boundary-testing, expected-values-never-come-from-the-subjects-output.md).
- R12. Every published surface change ships the bump its classification demands, in a changeset and in the api reports. The checker-parity lane passes on each PR, and the e2e lane passes on the first `main` push after each merge.

### Acceptance Examples

- AE1. **Covers R2.** Given a checker definition that declares checker protocol version 2 and a host that speaks version 1, when the host client connects, then it fails with `PluginLoadRefusedError{ProtocolVersionUnsupported}`. The exit class is ConfigError, which is what `stryker run` exits with. The message names the plugin, protocol `Checker`, host version 1 and worker version 2, and the definition's `check` handler never ran.
- AE2. **Covers R3.** Given a server that serves `CheckerRpcs` without the handshake, as a worker built on the released pre-T2 `plugin-runtime` does, when the host connects, then the same typed refusal reports "no handshake" within the boot window, and the connection is released.
- AE3. **Covers R7, R10.** Given the fixture checker definition, when the suite sends the same `check`, `group` and `digest` requests on each admitted transport, then each answers with the authored values and the same typed failures.
- AE4. **Covers R7.** Given a runner whose `mutantRun` streams events, when the host interrupts after the first event on each admitted transport, then no further event reaches the host and the transport closes without a leftover listener.
- AE5. **Covers R4.** Given options that set a checker-specific `tsconfigFile`, when the checker runs remotely, then it reads that option from the handshake and answers as it does in-process.
- AE6. **Covers R9.** The existing public-surface suites (`clean-temp-dir`, `break-threshold-exit`, `checker-rpc`, `worker-connection-loss`, `reporter-worker`, `mutant-deadline`, `dry-run-failure`, `mcp-server`, `incremental-report-roundtrip`) keep every expected value. Only the servers they build change, and those servers move to the published `plugin-runtime` entry.
- AE7. **Covers R13.** Given a remote worker in session `a`, when the connection drops and the host reconnects with session `a`, then requests are served again. When a second host connects with session `b`, then it is refused with a typed error, and session `a` keeps its answers.
- AE8. **Covers R14.** Given a served definition, when a client sends `check` before any handshake, then the session closes and the client's request fails with a connection error within the boot window.

### Scope Boundaries

**Deferred for later**

- Choosing in-process or remote from `stryker.config.*` or the CLI (Q4).
- Authentication or encryption on the remote transport. T2 binds only the address it is given, and U7's READMEs state that remote workers belong on trusted networks (Q1).
- A main-vs-branch verdict lane for the test runner, the counterpart of checker-parity. It would be a new CI gate, and `.github/workflows/` is read-only for this stream (Q3).
- Publishing the protocol suite to plugin authors (Q5). The plugin registry as data, and the out-of-tree fixture: both T5.
- The #346 backlog named in the Goal Capsule.

**Outside this work**

- A move from `effect/rpc/*` to another import path. Effect 4.0.0 ships these modules at `effect/rpc/*`, and no `effect/unstable/rpc` path exists in the installed package (Q2).
- Any change to mutant verdict logic, scheduling, or the reporter event model.

### Dependencies / Assumptions

- Effect 4.0.0's `RpcServer` answers an unknown request tag with `sendRequestDefect(…, 'Unknown request tag: …')` (`effect/src/rpc/RpcServer.ts:786-787` in the installed package). R3 relies on this to identify a pre-handshake worker, so U3 pins it (pack: boundary-testing, pin-dependency-semantics.md).
- A plugin's library entry does not bundle `effect` (the TypeScript checker's library build bundles only `@std/jsonc`, `tsdown.config.ts:16-21`). An in-process definition therefore runs on the host's `effect` when the versions dedupe. The spawned entry bundles everything (`:22-32`) and stays isolated.
- Effect's own RPC envelope sits below the handshake. Hosts and workers on Effect builds whose envelope differs cannot decode the handshake at all, and fail as a decode defect. The redesign plan accepted this bounded loss (`:299`), and it stays a residual risk. go-plugin separates the same two layers with a core protocol version beside the application's (Sources).
- The checker-parity lane builds its main side from the PR's base commit (`.github/workflows/ci.yml:491,537`). While `main` predates the handshake, that side is a pre-handshake checker (KTD10).
- The e2e lane runs only on `main` pushes (`.github/workflows/e2e.yml:3-6`), so the worker migration gets its first e2e run after merge.

## Planning Contract

### Key Technical Decisions

- KTD1. **Two stacked PRs on `main` (OP13b).**
  - PR A (U1-U4, U7) carries versions, the handshake, options-over-handshake, `Worker.serve`, the spawned transport and every migration. The engine is then versioned with today's placement.
  - PR B (U5, U6) adds the in-process and remote transports, the suite and the cross-transport verdict tests. It also deletes KTD10's transitional parity path.
  - Each layer leaves `main` releasable.
- KTD2. **The handshake is its own RPC group, `Handshake.hello`, merged with the served group by `plugin-runtime` and by the host client.**
  - A protocol is a value: `{ name, version, rpcs }`. `plugin-interface` publishes `Plugin.TestRunnerProtocol`, `CheckerProtocol` and `ReporterProtocol`, and any caller can declare its own (the `PingRpcs` fixture does).
  - `hello` carries `{ protocol, version, session, options }` and returns `{ protocol, version }`. Handlers never implement it.
  - A pre-T2 worker answers with an unknown-tag defect, which maps to `NoHandshake`.
  - Considered and rejected: a go-plugin-style version line on stdout before any RPC. An in-process placement has no stdout, so the version would need a second mechanism.
- KTD3. **The refusal is a new `PluginLoadRefusedError` reason, `ProtocolVersionUnsupported{protocol, hostVersion, worker: Spoke{version} | NoHandshake}`.**
  - The reason union lives in `packages/stryker-js-cli-contract/src/plugin-load-failure-reason.schema.ts`, so `contract/stream.schema.json` is regenerated (its own test byte-compares it).
  - `FAILURE_EXIT_CLASS` maps the reason to `ConfigError` (`packages/stryker-js/src/PluginsError.schema.ts:20-26`).
  - `plugin-load-report.service.ts` gains its next action (`:18` precedent).
  - The error message renders the reason's fields.
- KTD4. **Evidence-bearing connection types (pack: boundary-testing, staged-protocol-evidence.md).** `connect` yields an RPC client only after an admitted handshake. No code path can send `check` or `dryRun` on an unshaken connection, and the type checker enforces it.
- KTD5. **Transports are driver-backed layers beside the client service. Their scopes close the server, socket and child (pack: cell-architecture, service-and-layer-boundaries.md; pack: cell-architecture, scoped-lifecycle-boundaries.md).**
  - In-process: `RpcServer.layer` over an in-memory socket pair with `layerNdjson`.
  - Spawned: spawns as today, minus `options.json`.
  - Remote: `NodeSocket.layerNet` (`@effect/platform-node-shared/src/NodeSocket.ts:506`).
- KTD6. **`Worker.serve(definition)` and `Worker.serveOn(definition, socketServer)` replace `Worker.workerServerLayer` and `Worker.WorkerOptions.layerConfig`, with no alias (DEL1).**
  - The address comes from `STRYKER_SOCKET` (Unix path) or `STRYKER_LISTEN` (`host:port`).
  - After binding, `serve` writes one announcement line through Effect's `Stdio`, encoded by the published `WorkerAnnouncement` schema in `plugin-interface` (for example `stryker-worker 1 tcp 127.0.0.1:43123`). The host client decodes the same schema for `Remote`.
  - Handlers read options from the `WorkerOptions` service, which `serve` fills from the admitted handshake.
  - A request before the handshake ends the session (R14).
- KTD7. **No new dependency.** Everything is `effect`, `@effect/platform-node(-shared)` and `effect-gherkin-spec`, all in the catalog.
- KTD8. **`PluginRpcs.service.ts` is edited in place, not renamed.** The rename belongs to the Service-less `*.service.ts` backlog.
- KTD9. **Test-layer admission (`skill://test-layer-selection`, default refuse).**
  - Admitted:
    - schema codec laws and refusal files (U1)
    - the workflow property test (U3)
    - in-process integration features whose servers run inside the test process, over an in-memory socket or TCP loopback (U3, U5, U6)
    - the Effect pin (U3)
  - Refused, pending Q6: any new integration test whose test or subject spawns a process, which is the spawned row of U5 and U6.
  - The spawned path keeps its existing coverage: `type-query-worker.integration.test.ts`, `dry-run-module-evidence.integration.test.ts`, the engine suites in AE6, and the e2e lane.
  - No new e2e journey: the refusal's exit class is a property of `PluginLoadRefusedError`, so it is delegated downward.
- KTD10. **Checker-parity keeps one transitional pre-handshake client in `test/checker-parity` during PR A.**
  - The lane's main side is the base commit's checker (`ci.yml:491,537`), which reads `options.json` and has no handshake.
  - `run-side.ts` writes that file and connects without `hello` only when the main worker answers `NoHandshake`. The branch side always uses the new client.
  - PR B, whose base then carries the handshake, deletes the path.

### Implementation Units

#### U1. Protocol values, the handshake group and the announcement format

- **Goal:** one shared contract for versions, the handshake and the bound address.
- **Requirements:** R1, R2, R3, R4, R8, R13.
- **Dependencies:** none.
- **Files:** `packages/stryker-js-plugin-interface/src/PluginRpcs.service.ts`, new `src/ProtocolVersion.schema.ts`, new `src/WorkerAnnouncement.schema.ts`, `src/Plugin/mod.ts`, `etc/stryker-js-plugin-interface.api.md`, `README.md`.
- **Approach:**
  - `ProtocolVersion` is a refined positive integer (pack: schema-laws, invariants-as-refinements.md).
  - `HelloRequest{protocol, version, session, options}` reuses the options schema `WorkerOptionsWire` decodes today. `HelloAnswer{protocol, version}`.
  - `WorkerAnnouncement` is a line codec for `{transport: 'unix' | 'tcp', address}`.
  - Payloads omit optional keys (SCHEMA-1, `packages/AGENTS.md`).
- **Test scenarios:**
  - Generated round-trip laws on `HelloRequest`, `HelloAnswer` and `WorkerAnnouncement` cover acceptance.
  - A hand-written refusal file rejects version 0, a negative version, a line with an unknown transport, and a TCP address with no port (pack: schema-laws, refusals-beside-generated-laws.md).
  - No mutation report applies: the package is outside the mutation corpus (`.github/workflows/mutation.yml:36`).
- **Verification:** `pnpm exec turbo run typecheck api:check lint lint:tsgo test --filter=@systemfsoftware/stryker-js-plugin-interface`.

#### U2. `plugin-runtime` serves a definition at an address

- **Goal:** one `serve` that binds, announces, admits one session and provides options.
- **Requirements:** R4, R5, R6, R8, R13, R14.
- **Dependencies:** U1.
- **Files:** `packages/stryker-js-plugin-runtime/src/worker-server.blueprint.ts` (rewritten), `src/Worker/mod.ts`, `src/worker-options.service.ts`, `src/worker-options.schema.ts`, `etc/stryker-js-plugin-runtime.api.md`, `README.md`.
- **Approach:**
  - `Worker.define({ protocol, handlers, schemaServices })` returns an inert value.
  - `serve` merges `Handshake` into the protocol's group and restricts a Unix socket to `0o600` as today.
  - It answers `hello` with the definition's own protocol and version, admitting the first session id and re-admitting the same id.
  - It refuses another session id, and ends a session whose first request is not `hello`.
  - It announces the bound address (KTD6).
- **Patterns:** `restrictedSocket` (`worker-server.blueprint.ts:24-41`); blueprint and handle (`packages/stryker-js/src/Checker/checker-pool.blueprint.ts:55-103`).
- **Test scenarios:** the package has no `tests/`. U3's refusal feature and U5's suite exercise `serve` and `serveOn` through real definitions served in the test process.
- **Verification:** typecheck, `api:check`, lint and `lint:tsgo` for the package.

#### U3. The host client completes the handshake and refuses skew

- **Goal:** every connection is versioned, and a refusal reaches the user.
- **Requirements:** R2, R3, R4, R9, R14.
- **Dependencies:** U1, U2.
- **Files:**
  - in `packages/stryker-js/src/`: `worker-client.blueprint.ts`, `worker-protocol.blueprint.ts`, `node-platform.ts` (drop the `options.json` write), `PluginsError.schema.ts`, `plugin-load-report.service.ts`, `Worker/mod.ts`, `Checker/Checker.blueprint.ts`, `TestRunner.blueprint.ts`, `reporter-stream.service.ts`
  - new `admit-protocol-version.workflow.ts` and `__tests__/admit-protocol-version.workflow.property.test.ts`
  - new `packages/stryker-js/tests/protocol-version.integration.test.ts`
  - `packages/stryker-js/etc/stryker-js.api.md`
  - `packages/stryker-js-cli-contract/src/plugin-load-failure-reason.schema.ts`, `contract/stream.schema.json` and `etc/stryker-js-cli-contract.api.md`
- **Approach:**
  - `admit-protocol-version.workflow.ts` is a pure decision: `{expected, answer: Spoke | NoHandshake}` to `Admitted | Refused` (pack: cell-architecture, pure-decision-workflows.md).
  - `Worker.connect({ protocol, transport })` replaces `makeWorkerClient`. It sends `hello` with a fresh session id inside the boot window, re-sends it on reconnect, and maps the unknown-tag defect to `NoHandshake`.
  - The three engine call sites use the spawned transport.
- **Test scenarios:**
  - `protocol-version.integration.test.ts` serves a checker definition declaring another version through `Worker.serveOn` on TCP loopback inside the test process. `connect` fails with `ProtocolVersionUnsupported`, exit class ConfigError, and a message naming both versions, and the `check` handler never ran (AE1).
  - In the same feature, a plain `effect/rpc` server for `CheckerRpcs` with no handshake group is refused as `NoHandshake` within the boot window (AE2).
  - In the same feature, a plain `effect/rpc` client sending `check` first to a served definition sees the session close (AE8).
  - Pin: an `effect/rpc` server without a tag answers it with an `RpcClientDefect` containing "Unknown request tag". An Effect upgrade that changes this fails here first.
  - Property test: only an equal protocol and version is admitted. Expected values come from the rule, not from the workflow. The workflow is new, so no `main` mutant ids exist. It enters mutation by suffix (`packages/stryker-js/stryker.config.ts:15-17`, workflow files only, ADR-0004).
- **Verification:** `pnpm exec turbo run typecheck api:check lint lint:tsgo test --filter=@systemfsoftware/stryker-js --filter=@systemfsoftware/stryker-js-cli-contract`.

#### U4. Migrate every worker program, test server and client caller

- **Goal:** nothing is left on the removed API, and the first-party plugins publish their definitions.
- **Requirements:** R4, R5, R9.
- **Dependencies:** U2, U3.
- **Files:**
  - Plugins: `packages/stryker-js-typescript-checker/src/{main.ts,runtime/mod.ts}`; `packages/stryker-js-vitest-runner/src/{main.ts,mod.ts}`.
  - Fixture worker programs under `packages/stryker-js/tests/__fixtures__/`: `closure-only-runner`, `cost-checker`, `frozen-runner`, `program-digesting-checker`, `refusing-reporter`, `rejecting-checker`, `subsumption-checker/serve.mjs` and `deaf-runner/worker.mjs`.
  - Test-built servers: `substituted-worker.fixture.ts`, `substituted-reporter-worker.fixture.ts`, `substituted-trace-worker.fixture.ts`, `checker-rpc.integration.test.ts`, `mutant-deadline.integration.test.ts`, `worker-connection-loss.integration.test.ts`.
  - Other callers: `packages/stryker-js-typescript-checker/tests/type-query-{worker,unenforced-context}.integration.test.ts`; `test/checker-parity/src/run-side.ts` (KTD10); both plugins' READMEs.
- **Approach:**
  - Each plugin exports `definition` from a library entry (the checker from `./runtime`, the runner from `.`). Each `main.ts` shrinks to `Worker.serve(definition)` plus its platform layers.
  - Test-built servers move from raw `RpcServer.layer` to `Worker.serveOn`, so they answer the handshake. Their handlers and expected values do not change. `PingRpcs` gets its own protocol value.
  - `deaf-runner` never handshakes, so it writes its pid to a fixed file in its working directory instead of reading `pidFile` from options. `dry-run-failure.integration.test.ts` reads it there.
- **Test scenarios:** test expectation: none new. AE6 holds, and the type-query worker tests assert unchanged answers.
- **Verification:**
  - per-package typecheck, api:check, lint and test for both plugins, `@systemfsoftware/stryker-js` and `@systemfsoftware/stryker-checker-parity`.
  - `git grep -n -e workerServerLayer -e 'WorkerOptions\.layerConfig' -e 'options\.json' -e makeWorkerClient -- packages test ':!*.md' ':!**/CHANGELOG.md' ':!test/checker-parity'` returns nothing in PR A (DEL1). PR B runs it without the last exclusion.

#### U5. In-process and remote transports, and the protocol suite

- **Goal:** one public client with three transports, and one suite run over every admitted transport.
- **Requirements:** R6, R7, R8, R10, R13.
- **Dependencies:** U4 (PR B).
- **Files:** `packages/stryker-js/src/worker-client.blueprint.ts`, new `src/worker-transport.blueprint.ts`, `src/Worker/mod.ts`, `etc/stryker-js.api.md`; new `packages/stryker-js/tests/plugin-protocol.integration.test.ts`; `test/checker-parity/src/run-side.ts` (delete KTD10's path); fixtures reused from U3 and U4.
- **Approach:**
  - `Transport = InProcess{definition} | Spawned{entrypoint, …} | Remote{announcement}` is a tagged union. Remote starts nothing.
  - In the suite, `Given` serves the fixture definition with `Worker.serveOn` on `127.0.0.1:0` inside the test process, captures its announcement through an in-process `Stdio` layer, and connects by decoding that line (R8).
- **Test scenarios:** one `scenarioOutline` over `in-process | remote`, plus `spawned` if Q6 admits it. Each scenario is identical on every row:
  - The handshake is admitted, and options reach the handler, which echoes one option in its answer (AE5 shape).
  - `check`, `group` and `digest` return the fixture checker's authored answers (AE3).
  - `CheckerFailed` and a payload-decode refusal cross as the same typed values.
  - `mutantRun` streams in order. Interrupting after the first event ends the stream (AE4).
  - A dropped connection mid-request fails it with a typed `RpcClientError`, not a timeout. A reconnect with the same session is served again (AE7).
  - A second host with another session is refused, and the first keeps answering (AE7).
  - The version-mismatch definition is refused with the same typed error on every row.
  - Teardown: after the scope closes, the TCP port refuses connections and the in-memory socket reports closed (pack: boundary-testing, real-system-oracles.md, clean teardown).
- **Verification:** `pnpm exec turbo run typecheck api:check lint lint:tsgo test --filter=@systemfsoftware/stryker-js --filter=@systemfsoftware/stryker-checker-parity`; the U4 grep without the `test/checker-parity` exclusion.

#### U6. Same verdicts from the real plugins over every admitted transport

- **Goal:** the shipped checker and runner are verdict-lossless across placements.
- **Requirements:** R11.
- **Dependencies:** U5.
- **Files:** new `packages/stryker-js-typescript-checker/tests/transport-verdicts.integration.test.ts`; new `packages/stryker-js-vitest-runner/tests/transport-verdicts.integration.test.ts`; a small fixture project in each package's `tests/__fixtures__/` whose mutants carry authored expected outcomes.
- **Approach:** each feature runs a `scenarioOutline` over `in-process | remote` (plus `spawned` if Q6 admits it) against the package's published `definition`, served inside the test process. The authored verdicts are the oracle, and equality across rows is a second one (CONST-T10).
- **Test scenarios:** checker: compile-error, passed and ignored mutants get their authored answers on every row. Runner: dry-run test ids and per-mutant killed or survived match the authored table on every row.
- **Verification:** per-package `test` for both plugins.

#### U7. ADR, docs and changesets

- **Goal:** the decision and the surface changes are recorded where readers look.
- **Requirements:** R1, R12.
- **Dependencies:** lands with PR A. PR B adds its own changeset.
- **Files:** new `docs/adr/0005-versioned-plugin-worker-protocol.md` (supersedes the redesign plan's no-handshake decision); READMEs of `plugin-interface`, `plugin-runtime` (authoring with `define` and `serve`, the announcement line, the trusted-network note) and both plugins; `.changeset/*.md`.
- **Approach:**
  - Bumps follow the classification (BREAK-1): `major` for `plugin-interface`, `plugin-runtime`, `stryker-js`, the checker and the runner.
  - `stryker-js-cli-contract` is classified from its stream-schema change, a new member in a union that stream consumers decode.
  - Any other package the Turbo `typecheck` dry run names gets its honest bump.
- **Test scenarios:** test expectation: none (docs).
- **Verification:** `check_changeset.ts` on each changeset; `./bin/dprint check`.

### Verification Contract

| Check                  | Command or source                                                                                                                                                                                                        | Proves       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Per-package gates      | `pnpm exec turbo run typecheck api:check lint lint:tsgo test --filter=<package>` for each touched package, one heavy step at a time, never workspace-wide                                                                | U1-U6        |
| Removal                | the U4 `git grep` (PR A with, PR B without, the `test/checker-parity` exclusion) returns nothing                                                                                                                         | DEL1         |
| Protocol suite         | `plugin-protocol.integration.test.ts`, every admitted row green                                                                                                                                                          | R7, R10, R13 |
| Refusal                | `protocol-version.integration.test.ts`                                                                                                                                                                                   | R2, R3, R14  |
| Checker verdict parity | `checker-parity` legs on each PR (`ci.yml:305-351`, triggered by the checker's workspace closure, `test/checker-parity/src/lane-trigger.ts:20-67`)                                                                       | R11, R12     |
| e2e                    | first `main` push after each merge (`e2e.yml`, postsubmit only)                                                                                                                                                          | R9, R12      |
| Review                 | full-path `ce-code-review` per PR: report-only, every matched pack rule with file:line, non-Claude served models (DeepSeek V4.1 lenses plus a separate omp-routed MiniMax peer), finding dispositions and fixing commits | CONST-E7     |

No speed claim is made, so no timing measurement is owed. Mutation runs only in CI on `main`.

### Definition of Done

- PR A and PR B are merged to `main`, each with green CI on its reported head, a full-path receipt, and the checker-parity legs passing.
- The e2e lane is green on the first `main` push after each merge.
- AE1-AE8 hold on `main`. The U4 removal grep returns nothing without exclusions after PR B.
- ADR-0005 is accepted. Changesets match the Turbo gate's moved set.
- No file under `test/e2e-core`, no new test-tooling package, and no edit to `release.jsonc`, `turbo.json` or `.github/workflows/`.

### Questions for root

- Q1. **Remote security:** T2 binds the remote listener only to the address it is given, with no authentication, and documents remote as trusted-network only. Default: accept that. The alternative is a token in `hello` now.
- Q2. **Import path:** the contract names `effect/unstable/rpc`, but Effect 4.0.0 exposes these modules only as `effect/rpc/*`, which the repo already uses. Default: keep `effect/rpc/*`.
- Q3. **Runner verdict parity:** without a new CI lane, runner losslessness rests on U6's authored fixtures plus the e2e journeys on `main`. Default: no new lane. A runner-parity lane would be a new gate for its owner to approve.
- Q4. **Config surface:** in-process and remote are library-level only in T2. Default: defer config and CLI selection.
- Q5. **Suite for plugin authors:** publishing the protocol suite for T5's out-of-tree plugin would add public test surface. Default: not in T2; T5 decides.
- Q6. **Spawned row (blocks U5):** the contract asks for the suite to pass "in a worker". The admission gate refuses integration tests that spawn a process ("Spawning a process in an integration test is an automatic fail"). Default: refuse. The spawned transport then rests on the existing spawning tests and the e2e lane, which narrows the contract's clause and needs root's approval. The alternative admits one `spawned` row in U5 and U6, where the published client spawns the fixture worker as its product behaviour and the test itself spawns nothing. Two reviewers read the gate's "by the test runner" wording as allowing this.

### Sources

- Grounding dossiers from this session (protocol inventory, test and CI evidence, T5 setup, the installed Effect RPC API), with path:line above.
- `docs/plans/2026-09-16-1241-refactor-plugin-system-redesign-plan.md:46,48,299,300`: the decisions this plan supersedes and the risk it keeps.
- `docs/solutions/runtime-errors/stage-scope-closed-with-exit-void-hides-run-outcome.md`: scope-exit claims are settled by a run. This is why U5 checks teardown through real sockets and ports.
- go-plugin's handshake (https://github.com/hashicorp/go-plugin/blob/main/docs/internals.md): one stdout line carrying a core and an application protocol version plus the address, and a readable error on mismatch. Prior art for R2, R8 and the envelope risk.
- Packs enrolled in `.compound-engineering/config.yaml` at systemfsoftware `a578c704`: cell-architecture, boundary-testing, schema-laws, package-topology (cited inline).
