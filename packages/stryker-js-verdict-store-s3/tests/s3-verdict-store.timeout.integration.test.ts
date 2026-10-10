import { NodeSocketServer } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { layer, type S3VerdictStoreOptions } from '@systemfsoftware/stryker-js-verdict-store-s3'
import { VerdictStoreUnavailable } from '@systemfsoftware/stryker-js/verdict-store'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'

const Feature = makeFeature({ it })

const BUCKET = 'stryker-verdicts'
const PREFIX = 'pull-requests'

interface SilentEndpointShape {
  readonly url: string
}

class SilentEndpoint extends Context.Service<SilentEndpoint, SilentEndpointShape>()(
  '@systemfsoftware/stryker-js-verdict-store-s3/tests/s3-verdict-store.timeout.integration.test/SilentEndpoint',
) {}

const LOOPBACK = '127.0.0.1'

const silentEndpointLayer = Layer.effect(
  SilentEndpoint,
  Effect.gen(function*() {
    const server = yield* NodeSocketServer.make({ port: 0, host: LOOPBACK })
    yield* Effect.forkScoped(
      server.run((socket) =>
        Effect.scoped(Effect.flatMap(socket.reader, (reader) => Effect.forever(reader.pull))).pipe(Effect.ignore)
      ),
    )
    const port = yield* Match.valueTags(server.address, {
      InetAddressV4: (inet) => Effect.succeed(inet.port),
      InetAddressV6: (inet) => Effect.succeed(inet.port),
      UnixPathAddress: () => Effect.die(new Error('the silent endpoint bound no TCP port')),
    })
    return { url: `http://${LOOPBACK}:${port}` }
  }).pipe(Effect.orDie),
)

const optionsAt = (url: string): S3VerdictStoreOptions => ({
  bucket: BUCKET,
  prefix: PREFIX,
  region: 'us-east-1',
  endpoint: url,
  forcePathStyle: true,
  connectionTimeoutMs: 200,
  requestTimeoutMs: 300,
})

const buildRefusal = (options: S3VerdictStoreOptions): Effect.Effect<VerdictStoreUnavailable> =>
  Layer.build(layer(options)).pipe(Effect.scoped, Effect.flip, Effect.orDie)

Feature('Refusing an S3 endpoint that accepts connections and never answers', { timeout: 30_000 })
  .withLayer(silentEndpointLayer)
  .live('every request waits on a real loopback socket that never writes a byte')
  .body(({ scenario }) => {
    scenario(
      'Opening the store on such an endpoint is refused within the configured timeout, naming it',
      Gherkin.Do.pipe(
        Given('an endpoint that accepts the connection and never answers')(
          'options',
          () => SilentEndpoint.use((endpoint) => Effect.succeed(optionsAt(endpoint.url))),
        ),
        When('the S3 store opens')('refusal', (s) => buildRefusal(s.options)),
        Then('the run is refused with the store named and the timeout in the reason')((s, expect) =>
          expect({
            store: s.refusal.store,
            tag: s.refusal._tag,
            namesTimeout: /timeout/i.test(s.refusal.reason),
          }).toEqual({
            store: `s3://${BUCKET}/${PREFIX}`,
            tag: 'VerdictStoreUnavailable',
            namesTimeout: true,
          })
        ),
      ),
    )
  })
