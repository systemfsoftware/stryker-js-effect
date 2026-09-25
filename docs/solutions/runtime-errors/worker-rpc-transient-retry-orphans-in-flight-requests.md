---
title: Worker RPC transient retry orphans in-flight requests on a missed pong
date: 2026-09-24
category: runtime-errors
module: stryker-js
problem_type: runtime_error
component: tooling
symptoms:
  - "A mutation run with the TypeScript checker stops at 0/N progress while every process sits idle in epoll_wait, until the CI job timeout kills it"
  - "The checker worker logs `Unhandled error in SocketServer ... An error occurred during Read` shortly before progress stops"
  - "Raising the parent's pinger delay makes the stall disappear"
root_cause: async_timing
resolution_type: code_fix
severity: high
framework_version: effect 4.0.0-rc.117
tags: [effect-rpc, rpc-client, retry-transient-errors, ping-timeout, worker-protocol, typescript-checker, unstable-async, hang]
---

# Worker RPC transient retry orphans in-flight requests on a missed pong

## Problem

The parent built each worker's RPC client with `RpcClient.layerProtocolSocket({ retryTransientErrors: true })`. When a worker missed a pong for one ping window (5 s), the client reconnected but never failed the request that was already in flight on the old socket. Nothing would ever answer that request, so the run waited forever (issue #95).

## Symptoms

- Progress stays at `0/963` while the load average is 0.00, and every `worker.sock` connection is `ESTAB` with empty queues.
- The stall reproduces with a 5 s pinger and disappears with a 600 s pinger. That points at the ping, not the check itself.

## What Didn't Work

- Raising or disabling the ping interval only moves the threshold. A slower machine or any other transient socket error still orphans the request.
- A run-level wall-clock timeout turns the hang into a failure minutes later instead of settling the request when its connection is lost.

## Solution

Two independent fixes, both needed:

1. **Parent: fail in-flight requests on connection loss.** Every worker client now goes through one layer, `Worker.layerWorkerProtocol`, with transient retry off:

   ```ts
   RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
     Layer.provide(socket),
     Layer.provide(RpcSerialization.layerNdjson),
   )
   ```

   Inside `RpcClient.makeProtocolSocket`, the read loop's `tapCause` handler treats a `SocketOpenError` under `retryTransientErrors` as transient: it calls `onTransientError` and skips `broadcastError`. The pinger raises a missed pong as a `SocketOpenError` of kind `Timeout`, so it takes the same path. With the flag off, it reaches `broadcastError` and every pending request fails with a typed `RpcClientError`. `retryPolicy` still reconnects for requests made later. The typed error then reaches the engine's existing checker-crash path (`ChildProcessCrashedError` -> `Pool.invalidate`), which replaces the worker.

2. **Checker: stop blocking the ping thread.** The checker called `typescript/unstable/sync`, whose calls block the worker's only JS thread while the `tsc --api` child works. That thread also answers pings, so a long type check made a live worker look dead. The checker now uses `typescript/unstable/async` and awaits every API call through `Effect.promise`.

## Architectural Invariants

**INV-1: A dropped connection settles every request written to it.** A request is bound to the connection it was written on; a reconnect creates a new connection, not a new chance for the old request to be answered. Any transport that reconnects must fail (or replay) the requests pending on the old connection before or as it reconnects. "Retry quietly" is only safe for failures that happen before any request was written (connect-time errors).

```
on connection loss:
  for req in pending(connection): fail(req, ConnectionLost)   # never leave req waiting
  reconnect()                                                  # serves only new requests
```

**INV-2: A liveness probe measures the thread that answers it.** A ping answered on the same thread that runs blocking work reports "dead" whenever the work outlasts the ping window. Work that can outlast the window must run off that thread or through an async API.

Failure timing: with ping interval `P`, a worker is declared dead once a check blocks for longer than roughly `P` to `2P`. Before this fix, `time to settle = infinity` for any request in flight at that moment. After it, `time to settle <= 2P`.

## Code Smells

- `layerProtocolSocket({ retryTransientErrors: true })` on a client whose requests can be in flight when the socket drops. Use `Worker.layerWorkerProtocol` instead.
- A synchronous `typescript/unstable/sync` call (or any blocking IPC) inside a worker that also serves RPC pings.
- A regression test that asserts "a reconnect happened" but never that the in-flight request settled.

## Prevention

- The stryker-js regression suite `worker-connection-loss.integration.test.ts` drives a fixture worker that holds a request and goes silent past the ping window under `TestClock`. It asserts that the request settles with a typed error and that a later request is served after reconnect.
- The typescript-checker suite `checker-responsive.integration.test.ts` holds diagnostics past the ping window through a Deferred and asserts that the connection survives.

## Related Issues

- systemfsoftware/stryker-js-effect#95
- systemfsoftware/systemfsoftware#515 (opt-in supervisor escalation in effect-daemon-spec; restart budgets for respawned workers are deferred to it)
