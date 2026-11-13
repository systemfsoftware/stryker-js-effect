---
title: An S3 requestTimeout only warns unless the handler is told to throw
date: 2026-10-10
category: runtime-errors
module: stryker-js-verdict-store-s3
problem_type: runtime_error
component: verdict_store
severity: high
symptoms:
  - "A run against an S3 endpoint that accepts the TCP connection and never answers hangs with no error"
  - "The log shows `@smithy/node-http-handler - [WARN] a request has exceeded the configured … ms requestTimeout` and the request keeps waiting"
  - "A silent test endpoint built on `NodeSocketServer` never closes, so the suite ends in a hook timeout"
root_cause: wrong_api
resolution_type: code_fix
framework_version: "@smithy/node-http-handler 4.12.1"
tags: [s3, aws-sdk, timeout, node-http-handler, verdict-store, socket-server, test-endpoint]
retire_when: "`setRequestTimeout` in @smithy/node-http-handler rejects the request without `throwOnRequestTimeout` (check its dist-cjs/index.js)"
---

# An S3 requestTimeout only warns unless the handler is told to throw

## Problem

The S3 verdict store `layer` built its `S3Client` from region, endpoint and path style only. The SDK default request handler bounds nothing, so an endpoint that accepts connections and never answers (a black-holing proxy, a stalled emulator) hangs every store call and the run never finishes.

## Failure mechanics

1. No handler timeouts: a request waits for the first response byte forever. Run time is unbounded.
2. `requestTimeout` alone: when the timer fires, `setRequestTimeout` in `@smithy/node-http-handler` 4.12.1 logs `[WARN] … Init client requestHandler with throwOnRequestTimeout=true to turn this into an error.` and leaves the request open. Run time is still unbounded; only a log line changes.
3. `requestTimeout` with `throwOnRequestTimeout: true`: the handler calls `req.destroy(error)` and rejects with `name: 'TimeoutError'`, `code: 'ETIMEDOUT'`. A store call then takes at most $T_{\text{connect}} + T_{\text{request}}$.

## Solution

`S3VerdictStoreOptions` gained `connectionTimeoutMs` (default 3000) and `requestTimeoutMs` (default 30000), and the client passes all three handler options:

```ts
new S3Client({
  region,
  endpoint,
  forcePathStyle,
  requestHandler: {
    connectionTimeout: options.connectionTimeoutMs ?? 3_000,
    requestTimeout: options.requestTimeoutMs ?? 30_000,
    throwOnRequestTimeout: true,
  },
})
```

The rejection maps to `storeUnavailable` like any other store I/O failure, and the `HeadBucket` probe at layer acquisition turns a silent endpoint into `VerdictStoreUnavailable` before any mutant is tested.

## Why this works

Invariant: every call to a configurable network endpoint has a bound that fails the call, not one that only reports it. A timeout that logs is not a bound. With `throwOnRequestTimeout`, the SDK's own timer is the bound, so no wrapper (`Effect.timeout`) is needed, and the socket is destroyed instead of leaked behind an abandoned fiber.

## Verification

The S3 package's timeout scenario points the public `layer` at a loopback `NodeSocketServer` that accepts connections and never writes a byte, and asserts that opening the store is refused with `VerdictStoreUnavailable` naming the store and the timeout, well inside the scenario's own timeout.

`NodeSocketServer` pauses every accepted connection until a handler reads it. A handler of `() => Effect.never` keeps the client socket open, so server shutdown waits on it and the test hangs in teardown instead of passing. The handler must drain the reader and never reply:

```ts
server.run((socket) =>
  Effect.scoped(Effect.flatMap(socket.reader, (reader) => Effect.forever(reader.pull))).pipe(Effect.ignore)
)
```

The client times out and destroys its socket, the reader ends, and the server scope closes.

## Code smells

- `new S3Client({...})` (or any SDK v3 client) with a configurable `endpoint` and no `requestHandler`.
- `requestHandler: { requestTimeout }` without `throwOnRequestTimeout: true`.
- A timeout test against a mocked client: a mock never shows that the timeout only warns.
