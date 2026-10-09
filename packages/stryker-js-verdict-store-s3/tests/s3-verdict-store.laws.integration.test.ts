import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { layer, type S3VerdictStoreOptions } from '@systemfsoftware/stryker-js-verdict-store-s3'
import {
  entryDirectoryOf,
  type ListOutcome,
  VerdictStore,
  VerdictStoreUnavailable,
} from '@systemfsoftware/stryker-js/verdict-store'
import { VerdictStoreHarness, verdictStoreLaws } from '@systemfsoftware/stryker-js/verdict-store/laws'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import { createEmulator } from 'emulate'

const Feature = makeFeature({ it })

const BUCKET = 'stryker-verdicts'
const PREFIX = 'pull-requests/'
const MUTANT_ID = Mutant.MutantId.make('0123456789abcdef')
const ENTRIES_PAST_ONE_PAGE = 1001
const PUT_CONCURRENCY = 16

class S3Emulator extends Context.Service<S3Emulator, { readonly url: string; readonly reset: Effect.Effect<void> }>()(
  '@systemfsoftware/stryker-js-verdict-store-s3/tests/S3Emulator',
) {}

const emulatorLayer = Layer.effect(
  S3Emulator,
  Effect.acquireRelease(
    Effect.promise(() => createEmulator({ service: 'aws', port: 0 })),
    (emulator) => Effect.promise(() => emulator.close()),
  ).pipe(Effect.map((emulator) => ({ url: emulator.url, reset: Effect.sync(() => emulator.reset()) }))),
)

const optionsAt = (url: string, overrides: Partial<S3VerdictStoreOptions> = {}): S3VerdictStoreOptions => ({
  bucket: BUCKET,
  prefix: PREFIX,
  region: 'us-east-1',
  endpoint: url,
  forcePathStyle: true,
  ...overrides,
})

const rawClientAt = (url: string): S3Client =>
  new S3Client({ region: 'us-east-1', endpoint: url, forcePathStyle: true })

const putRaw = (client: S3Client, key: string, body: string): Effect.Effect<void> =>
  Effect.promise(() => client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }))).pipe(
    Effect.asVoid,
  )

interface StoreUnderLaw {
  readonly layer: Layer.Layer<VerdictStore | VerdictStoreHarness, VerdictStoreUnavailable>
  readonly release: Effect.Effect<void>
}

const emptyBucketStore: Effect.Effect<StoreUnderLaw, never, S3Emulator> = Effect.gen(function*() {
  const emulator = yield* S3Emulator
  const client = rawClientAt(emulator.url)
  const emptyBucket = emulator.reset.pipe(
    Effect.andThen(Effect.promise(() => client.send(new CreateBucketCommand({ Bucket: BUCKET })))),
    Effect.asVoid,
  )
  yield* emptyBucket
  const harness = Layer.succeed(VerdictStoreHarness, {
    plant: (name, text) => putRaw(client, `${PREFIX}${name}`, text),
    reset: emptyBucket,
  })
  return {
    layer: Layer.merge(layer(optionsAt(emulator.url)), harness),
    release: Effect.sync(() => client.destroy()),
  }
})

const hexKeyOf = (index: number): string => index.toString(16).padStart(64, '0')

const listedCountOf = (outcome: ListOutcome): number =>
  Match.valueTags(outcome, {
    EntriesListed: (listed) => listed.entries.length,
    StoreUnavailable: () => -1,
  })

const buildRefusal = (options: S3VerdictStoreOptions): Effect.Effect<VerdictStoreUnavailable> =>
  Layer.build(layer(options)).pipe(Effect.scoped, Effect.flip, Effect.orDie)

Feature('Sharing mutation verdicts through an S3 bucket', { timeout: 120_000 })
  .withLayer(emulatorLayer)
  .live('the store talks HTTP to an S3 emulator listening on a real loopback port')
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'On the S3 store, <law>',
      verdictStoreLaws.map(({ law, history }) => ({ law, history })),
      (row) =>
        Gherkin.Do.pipe(
          Given('an empty S3 verdict store')('store', () => emptyBucketStore),
          When('the verdicts behind that rule are written and read back')(
            'observation',
            (s) => row.history.pipe(Effect.provide(s.store.layer), Effect.ensuring(s.store.release)),
          ),
          Then('the store answers exactly what the rule promises')((s, expect) =>
            expect(s.observation.observed).toEqual(s.observation.expected)
          ),
        ),
    )

    scenario(
      'A mutant with more verdicts than one listing page lists every one of them',
      Gherkin.Do.pipe(
        Given('a mutant with one more verdict than an S3 listing page holds')('store', () =>
          emptyBucketStore.pipe(
            Effect.tap((store) =>
              Effect.forEach(
                Arr.makeBy(ENTRIES_PAST_ONE_PAGE, hexKeyOf),
                (key) =>
                  VerdictStoreHarness.use((harness) =>
                    harness.plant(`${entryDirectoryOf(MUTANT_ID)}/tested-${key}.json`, '{}')
                  ),
                { concurrency: PUT_CONCURRENCY, discard: true },
              ).pipe(Effect.provide(store.layer), Effect.orDie)
            ),
          )),
        When('the store lists that mutant')('listed', (s) =>
          VerdictStore.use((store) => store.list(MUTANT_ID)).pipe(
            Effect.map(listedCountOf),
            Effect.provide(s.store.layer),
            Effect.ensuring(s.store.release),
          )),
        Then('every verdict is listed')((s, expect) => expect(s.listed).toEqual(ENTRIES_PAST_ONE_PAGE)),
      ),
    )

    scenario(
      'A bucket that does not exist stops the run before any verdict is read',
      Gherkin.Do.pipe(
        Given('a store configured with a bucket nobody created')(
          'options',
          () =>
            S3Emulator.use((emulator) =>
              emulator.reset.pipe(Effect.as(optionsAt(emulator.url, { bucket: 'never-created' })))
            ),
        ),
        When('the S3 store opens')('refusal', (s) => buildRefusal(s.options)),
        Then('the run is refused naming the store and the bucket')((s, expect) =>
          expect(s.refusal).toSatisfy(
            (refusal) =>
              refusal.store === `s3://never-created/${PREFIX}` &&
              refusal.reason.startsWith('the bucket never-created cannot be reached'),
            'the refusal names the s3 store and the bucket it could not reach',
          )
        ),
      ),
    )

    scenarioOutline(
      'An endpoint at <endpoint> stops the run before contacting it',
      [
        { endpoint: 'http://verdicts.example.com' },
        { endpoint: 'ftp://127.0.0.1:21' },
        { endpoint: 'not a url' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a store whose endpoint is ${row.endpoint}`)('options', () => Effect.succeed(optionsAt(row.endpoint))),
          When('the S3 store opens')('refusal', (s) => buildRefusal(s.options)),
          Then('the run is refused because the endpoint is not trusted')((s, expect) =>
            expect(s.refusal).toEqual(
              VerdictStoreUnavailable.make({
                store: `s3://${BUCKET}/${PREFIX}`,
                reason: row.endpoint === 'not a url'
                  ? 'the endpoint not a url is not a URL'
                  : `the endpoint ${row.endpoint} must be https unless its host is loopback or host.microsandbox.internal`,
              }),
            )
          ),
        ),
    )
  })
