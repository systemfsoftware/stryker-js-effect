import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as HttpServer from 'effect/http/HttpServer'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import type * as NetAddress from 'effect/net/NetAddress'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'

import { OtlpExportRequest } from './Otlp.schema.js'
import { ShellFailure } from './Shell.schema.js'
import { type SpanRecord, spanRecordsOf } from './span-counts.js'

const decodeOtlpExport = S.decodeResult(S.fromJsonString(OtlpExportRequest))

export interface OtlpReceiver {
  readonly endpoint: string
  readonly spans: Effect.Effect<ReadonlyArray<SpanRecord>>
}

const receive = (
  collected: Ref.Ref<ReadonlyArray<SpanRecord>>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* Effect.orElseSucceed(request.text, () => '')
    return yield* Result.match(decodeOtlpExport(body), {
      onFailure: () => Effect.succeed(HttpServerResponse.empty({ status: 400 })),
      onSuccess: (decoded) =>
        Effect.as(
          Ref.update(collected, (previous) => Arr.appendAll(previous, spanRecordsOf(decoded))),
          HttpServerResponse.jsonUnsafe({}),
        ),
    })
  })

const portOf = (address: NetAddress.SocketAddress): Option.Option<number> =>
  Match.valueTags(address, {
    InetAddressV4: (inet) => Option.some(inet.port),
    InetAddressV6: (inet) => Option.some(inet.port),
    UnixPathAddress: () => Option.none(),
  })

const unbound = ShellFailure.make({
  schemaVersion: 1,
  code: 'io-failed',
  reason: 'The OTLP receiver did not bind a TCP port.',
  nextAction: 'Check the runner allows listening on an ephemeral localhost port.',
})

export const startOtlpReceiver: Effect.Effect<OtlpReceiver, ShellFailure, Scope.Scope> = Effect.gen(function*() {
  const collected = yield* Ref.make<ReadonlyArray<SpanRecord>>([])
  const services = yield* Layer.build(NodeHttpServer.layerTest).pipe(
    Effect.mapError((cause) =>
      ShellFailure.make({
        schemaVersion: 1,
        code: 'io-failed',
        reason: `The OTLP receiver could not listen: ${cause.message}`,
        nextAction: 'Check the runner allows listening on an ephemeral localhost port.',
      })
    ),
  )
  const server = Context.get(services, HttpServer.HttpServer)
  yield* server.serve(receive(collected))
  const port = yield* Effect.mapError(Effect.fromOption(portOf(server.address)), () => unbound)
  return { endpoint: `http://127.0.0.1:${port}/v1/traces`, spans: Ref.get(collected) }
})
