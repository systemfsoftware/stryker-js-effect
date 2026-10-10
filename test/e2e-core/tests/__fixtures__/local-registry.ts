import * as Effect from 'effect/Effect'
import * as HttpServer from 'effect/http/HttpServer'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as NetAddress from 'effect/net/NetAddress'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as S from 'effect/Schema'

import { PackumentJson } from '@systemfsoftware/stryker-e2e-core'

export interface PublishedVersion {
  readonly version: string
  readonly time: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

export type Registry = Readonly<Record<string, ReadonlyArray<PublishedVersion>>>

const TARBALL_HOST = 'http://registry.invalid/'

const packumentOf = (name: string, published: ReadonlyArray<PublishedVersion>) => ({
  name,
  'dist-tags': { latest: published.at(-1)?.version ?? '' },
  versions: Object.fromEntries(published.map(({ time: _time, ...entry }) => [entry.version, {
    name,
    ...entry,
    dist: { tarball: `${TARBALL_HOST}${name}/-/${name.replace('/', '-')}-${entry.version}.tgz` },
  }])),
  time: Object.fromEntries(published.map((entry) => [entry.version, entry.time])),
})

const packumentBodiesOf = (registry: Registry) =>
  Effect.map(
    Effect.forEach(
      Object.entries(registry),
      ([name, published]) =>
        Effect.map(S.encodeEffect(PackumentJson)(packumentOf(name, published)), (body) => [name, body] as const),
    ),
    (bodies) => Object.fromEntries(bodies),
  )

const registryApp = (bodies: Readonly<Record<string, string>>) =>
  Effect.map(
    HttpServerRequest.HttpServerRequest,
    (request) =>
      Option.match(Rec.get(bodies, decodeURIComponent(request.url.slice(1))), {
        onNone: () => HttpServerResponse.empty({ status: 404 }),
        onSome: (body) => HttpServerResponse.text(body, { contentType: 'application/json' }),
      }),
  )

const loopbackUrlOf = (address: NetAddress.SocketAddress) =>
  NetAddress.isInetAddress(address)
    ? Effect.succeed(`http://127.0.0.1:${address.port}/`)
    : Effect.die(`the test registry listens on ${NetAddress.formatSocketAddress(address)}, which npm cannot reach`)

const listen = <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  Effect.gen(function*() {
    yield* HttpServer.serveEffect(app)
    const server = yield* HttpServer.HttpServer
    return yield* loopbackUrlOf(server.address)
  })

export const serveRegistry = (published: Registry) =>
  Effect.flatMap(packumentBodiesOf(published), (bodies) => listen(registryApp(bodies)))
