import * as Duration from 'effect/Duration'
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
  readonly tarball?: Uint8Array
}

export type Registry = Readonly<Record<string, ReadonlyArray<PublishedVersion>>>

const PUBLIC_REGISTRY_REWRITTEN_BY_NPM = 'https://registry.npmjs.org/'

const tarballPathOf = (name: string, version: string): string =>
  `${name}/-/${name.replace(/^@[^/]+\//, '')}-${version}.tgz`

const packumentOf = (name: string, published: ReadonlyArray<PublishedVersion>) => ({
  name,
  'dist-tags': { latest: published.at(-1)?.version ?? '' },
  versions: Object.fromEntries(published.map(({ time: _time, tarball: _tarball, ...entry }) => [entry.version, {
    name,
    ...entry,
    dist: { tarball: `${PUBLIC_REGISTRY_REWRITTEN_BY_NPM}${tarballPathOf(name, entry.version)}` },
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

const tarballsOf = (registry: Registry): Readonly<Record<string, Uint8Array>> =>
  Object.fromEntries(
    Object.entries(registry).flatMap(([name, published]) =>
      published.flatMap((entry) =>
        entry.tarball === undefined ? [] : [[tarballPathOf(name, entry.version), entry.tarball] as const]
      )
    ),
  )

const registryApp = (bodies: Readonly<Record<string, string>>, tarballs: Readonly<Record<string, Uint8Array>>) =>
  Effect.map(
    HttpServerRequest.HttpServerRequest,
    (request) => {
      const path = decodeURIComponent(request.url.slice(1))
      return Option.match(Rec.get(tarballs, path), {
        onSome: (bytes) => HttpServerResponse.uint8Array(bytes, { contentType: 'application/octet-stream' }),
        onNone: () =>
          Option.match(Rec.get(bodies, path), {
            onNone: () => HttpServerResponse.empty({ status: 404 }),
            onSome: (body) => HttpServerResponse.text(body, { contentType: 'application/json' }),
          }),
      })
    },
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
  Effect.flatMap(packumentBodiesOf(published), (bodies) => listen(registryApp(bodies, tarballsOf(published))))

export const serveLateRegistry = (answerAfter: Duration.Input) =>
  listen(Effect.as(Effect.sleep(answerAfter), HttpServerResponse.empty({ status: 404 })))
