---
title: Worker RPC protocol hangs when worker never listens on STRYKER_SOCKET
date: 2026-10-02
category: runtime-errors
module: stryker-js
problem_type: runtime_error
component: tooling
root_cause: async_timing
resolution_type: code_fix
severity: critical
tags: [effect-rpc, worker-protocol, layer-build, socket-connection, deferred, effect-4.0.0]
---

# Worker RPC protocol hangs when worker never listens on STRYKER_SOCKET

## Problem

When a plugin worker process (test runner, checker, or reporter) stays alive but never listens on `STRYKER_SOCKET`, `stryker run` hangs forever at `Starting dry run` (ticks `completed: 0`, no error). The worker-boot timeout and `dryRunTimeoutMinutes` never fire.

## Symptoms

- Progress indicator stays at `Starting dry run` with `completed: 0` mutants, no errors logged.
- The worker process is alive (visible in `ps`) but never binds to the socket specified in `STRYKER_SOCKET`.
- No boot timeout fires, and neither does `dryRunTimeoutMinutes`.
- All plugin-worker lanes (test runner, checker, reporter) hang if the worker never connects.

## What Didn't Work

- **Relying on `Layer.build` success**: The code assumed that once the `RpcClient.layerProtocolSocket({ retryTransientErrors: true })` layer built, the connection was established. It was not.
- **Retrying and catching on the build effect**: `makeWorkerClient` wrapped the build in `Effect.retry(connectRetry)` and mapped `SocketError` to `WorkerBootTimeoutError`. Neither ever ran, because the build never fails: the connect attempts happen in a forked fiber after the build has returned.
- **Over-mocked test fixtures**: Substituting a protocol layer that fails at build time hid the real bug, because the real layer never fails at build time, even when every connection attempt fails.

## Solution

Modified `worker-protocol.blueprint.ts` to observe socket readiness explicitly before returning from the layer build:

1. **Create a `Deferred` to track connection readiness:**
   ```typescript
   const connected = yield * Deferred.make<void>()
   ```

2. **Hook into the RPC client's `onConnect` callback and complete the Deferred:**
   ```typescript
   const hooks = Layer.succeed(RpcClient.ConnectionHooks, {
     onConnect: Deferred.succeed(connected, undefined).pipe(
       Effect.andThen(FiberSet.run(
         liveConnections,
         Effect.never.pipe(Effect.onInterrupt(() => failInFlightRequests(responseHandlers))),
       )),
       Effect.asVoid,
     ),
     onDisconnect: FiberSet.clear(liveConnections),
   })
   ```

3. **Await the Deferred before returning the protocol** in `makeWorkerProtocol`:
   ```typescript
   yield * Deferred.await(connected) // ← Force build to wait for actual connection
   ```

4. **Apply a bounded timeout** in `makeWorkerClient`:
   ```typescript
   const WORKER_BOOT_TIMEOUT = Duration.seconds(30)

   const protocol = yield * worker.pipe(
     clientLayer,
     Layer.build,
     Effect.raceFirst(worker.exited),
     Effect.timeoutOrElse({ duration: WORKER_BOOT_TIMEOUT, orElse: bootTimedOut }),
     Effect.catchTag('SocketError', bootTimedOut),
   )
   ```

## Why This Works

**Root cause:** effect 4.0.0's `RpcClient.layerProtocolSocket({ retryTransientErrors: true })` constructs a layer that forks a background fiber to open the socket and retry connection failures. The layer resource is created immediately (the fiber spawns), but the socket may not connect yet. The `Layer.build` operation returns after resource allocation, not after connection establishment. Under `retryTransientErrors`, socket open errors trigger `defaultRetryPolicy` (exponential backoff, 5s max spacing, no attempt cap) with no error broadcast. The caller never sees the error.

This breaks the implicit contract that `Layer.build` == connection ready. `makeWorkerClient` attempted to enforce readiness via:

- `Effect.retry(connectRetry)` around the build, which never failed, so it never retried
- `catchTag('SocketError', ...)`, which never saw an error, because transient open errors are retried inside the forked fiber and never broadcast

**The fix makes readiness observable.** By inserting `Deferred.await(connected)` in `makeWorkerProtocol`, the build suspends until `ConnectionHooks.onConnect` fires, which happens only after the socket's reader has opened (Node's `connect` event). So:

1. The layer effect no longer returns until the socket is ready.
2. The outer `Effect.timeoutOrElse` in `makeWorkerClient` now races a meaningful, observable operation.
3. When the timeout fires (or the worker exits), the awaiting effect fails, triggering the boot error.

## Prevention

**Test 1: Real protocol over refusing socket** (`worker-boot-timeout.integration.test.ts`) uses the real `Worker.layerWorkerProtocol` (not a substituted layer) over a socket whose reader always fails with `SocketOpenError`. It forks the boot, advances `TestClock` by a minute, and asserts the boot failed with `WorkerBootTimeoutError` naming the worker pid. If the boot fiber is still running after the adjust, the step dies with "the host was still waiting on a worker that never accepted its connection" instead of hanging.

**Test 2: Real worker that never binds** — performs a real dry run with a plugin worker fixture that stays alive but never listens on `STRYKER_SOCKET`. Asserts that the run fails at the `dryRun` stage with a `TestRunnerFailed` cause, naming the worker PID and the boot window message.

```typescript
scenario(
  'A test runner that never accepts its connection fails the run with a boot error',
  Gherkin.Do.pipe(
    Given('a project whose test runner never accepts its connection')('project', () => writeProject()),
    When('the mutation run performs its initial test run')(
      'run',
      (s) => runWithRunnerPlugin(s.project, DEAF_RUNNER_PLUGIN),
    ),
    Then('the dry run fails with a TestRunnerFailed boot error naming the worker')((s, expect) =>
      expect({
        stage: failure.stage,
        causeTag: bootCause?._tag,
        causePhase: bootCause?.phase,
        namesTheWorkerPid: bootCause?.cause.includes(`Worker ${s.run.workerPid}`),
      }).toEqual({
        stage: 'dryRun',
        causeTag: 'TestRunnerFailed',
        causePhase: 'init',
        namesTheWorkerPid: true,
      })
    ),
  ),
)
```

## Code Smells

- Using `RpcClient.layerProtocolSocket({ retryTransientErrors: true })` and assuming the layer build guarantees a connection. `Layer.build` is not a connection readiness signal; it is only resource initialization.
- Mocking connection failures with a layer that fails at build time (eagerly), when the real layer might fail at connection time (deferred).
- Missing bounds on the time waited for a worker to accept an RPC connection.

## Related Issues

- **systemfsoftware/stryker-js-effect#144**: This issue and its fix.
- **docs/solutions/runtime-errors/worker-rpc-transient-retry-orphans-in-flight-requests.md**: a worker that connects and then drops its connection orphaned in-flight requests (#95). This fix leaves that reconnect path alone; it only gates the first connection.
