---
title: Fork a warm host-access microsandbox VM through a full snapshot and a forked restore, not branch()
date: 2026-09-25
category: tooling-decisions
module: e2e-lane
problem_type: tooling_decision
component: testing_framework
severity: high
applies_when:
  - "An E2E harness wants one warm microsandbox 0.7.2 VM per test file and a clean copy-on-write fork per run"
  - "The forks must reach the host (OTLP collector at host.microsandbox.internal) through the public+host network profiles"
  - "The warm VM's disk was just populated with a large tree (a baked fixture with node_modules)"
tags: [microsandbox, e2e, snapshot, fork, copy-on-write, host-access, drop-caches]
---

# Fork a warm host-access microsandbox VM through a full snapshot and a forked restore, not branch()

## Context

The E2E lane (`test/e2e`) moved from one cold job microVM per Stryker run to one warm VM per test file, forked per run. The obvious microsandbox 0.7.2 primitive is `Sandbox.branch()`, and the plan assumed it. Two probes on real VMs showed the obvious path does not work for this lane.

## Guidance

Capture a full snapshot of the populated warm VM once, then stop the VM and restore a forked child for each run with an explicit host-access policy:

```ts
// Warm.boot populates and captures; Warm.fork restores (E2E harness warm-sandbox handle)
const populateScript = `mkdir -p /work && cp -a /baked/. /work/ && sync && echo 3 > /proc/sys/vm/drop_caches`

Snapshot.builder(snapshotName).fromSandbox(sandbox.name).full().guestFlush('required').create()

Sandbox.restore(warm.snapshot)
  .name(name)
  .forked()
  .allowMissingResources() // the warm VM's /baked host bind mount is not carried into forks
  .networkPolicy(NetworkPolicy.fromProfiles(['public', 'host']))
  .restore()
```

- The warm VM needs no host access; the forks get it from the restore builder.
- Drop the guest page cache before capture. Without it, a full snapshot of a VM that just copied a fixture fails with `[SnapshotIntegrity] ... checkpoint object exceeds 1048576 bytes` (reproduced on `calc-fixture`, the smallest baked fixture).
- Scope each fork with `Effect.acquireRelease` and tear it down stop -> kill -> `destroy({ force: true })`, uninterruptible, mirroring `@systemfsoftware/effect-microsandbox`. Remove the snapshot with `Snapshot.remove(ref, { force: true })` in the warm handle's finalizer.

## Architectural Invariants

1. **Host access is a fork property, never a source property.** A source that holds host-backed resources cannot be branched, and inheriting its resources drags its host mounts along. Grant host access on the restore builder only.
2. **Snapshot only a quiescent guest.** A full capture serializes guest memory, so the page cache produced by a large copy lands in the checkpoint. `sync && drop_caches` before capture keeps the checkpoint under its bound.
3. **One snapshot, many forks, one owner.** The snapshot's finalizer belongs to the file-lifetime scope; every fork's finalizer belongs to the test scope that created it. Nothing outlives the scope that acquired it.

## Why This Matters

- `Sandbox.branch()` on a VM created with host network access fails with `invalid config: source uses host-backed proxy, TLS or secret resources; explicit compatible authorization is required (or dangerously_inherit_resources ...)`.
- A restore that inherits resources (`dangerouslyInheritResources()`) works, but the forks then inherit the host bind mount, which reads as `/baked: I/O error` in the child. `allowMissingResources()` plus an explicit network policy gives forks host access without the mount.
- The fork's `/work` sits on the guest disk, so every run starts from the same clean tree and writes stay private to the fork (probe: a marker written in fork A is absent in fork B; deleting `package.json` in A leaves it in B).
- Measured on the full lane: 121s -> 87s wall time, 15/15 journeys unchanged; the traced lifecycle journey still finds its spans in Tempo.

## When to Apply

- Any harness that forks microsandbox 0.7.2 sandboxes needing host access, or snapshots a VM right after a large disk write.
- Re-check when `@systemfsoftware/effect-microsandbox` exposes branching or snapshotting on `RunningVM`, or microsandbox changes the 1 MiB checkpoint bound; the raw-SDK path here exists only because the DSL (through 3.0.0) does not.

## Examples

A fork smoke that proves the substrate before trusting journey verdicts: boot the warm VM on a baked fixture, fork twice, write in one and check the other, `wget` a host server from a fork, and assert `Sandbox.list()` and `Snapshot.list()` are empty after the scope closes.

## Related

- `docs/plans/2026-09-25-0021-perf-e2e-warm-sandbox-fork-per-run-plan.md` (its KTD2 still names `branch()`; the implementation deviates as described here)
- `test/e2e/README.md` "Warm snapshots and forks"
