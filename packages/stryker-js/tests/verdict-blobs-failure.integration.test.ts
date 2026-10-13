import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  makeVerdictStore,
  PutSkipped,
  StoreUnavailable,
  VerdictBlobFailed,
  type VerdictBlobs,
  type VerdictComponents,
  VerdictComponentsSchema,
  type VerdictEntry,
  VerdictEntrySchema,
  VerdictStore,
} from '@systemfsoftware/stryker-js/verdict-store'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const UNAVAILABLE_REASON = 'the object store refused the connection'

const MUTANT_ID = Mutant.MutantId.make('0123456789abcdef')

const digestOf = (seed: string): string => seed.repeat(64)

const unreachableBlobs: VerdictBlobs = {
  read: (name) => Effect.fail(VerdictBlobFailed.make({ name, reason: UNAVAILABLE_REASON })),
  write: (name) => Effect.fail(VerdictBlobFailed.make({ name, reason: UNAVAILABLE_REASON })),
  list: (directory) => Effect.fail(VerdictBlobFailed.make({ name: directory, reason: UNAVAILABLE_REASON })),
}

const unreachableStoreLayer: Layer.Layer<VerdictStore> = Layer.succeed(
  VerdictStore,
  makeVerdictStore(unreachableBlobs),
)

const testedComponentsEncoded = {
  _tag: 'tested',
  engineDigest: digestOf('e'),
  runInputsDigest: digestOf('1'),
  mutantSetPolicy: 'default',
  mutantId: MUTANT_ID,
  fileName: 'src/math.ts',
  mutatorName: 'ArithmeticOperator',
  replacementDigest: digestOf('2'),
  location: { start: { line: 3, column: 10 }, end: { line: 3, column: 15 } },
  fileContentDigest: digestOf('3'),
  coveringTestIds: ['adds two numbers'],
  closureDigest: digestOf('4'),
  checkerConfigDigest: digestOf('5'),
}

const decodeComponents = (): Effect.Effect<VerdictComponents> =>
  Effect.orDie(S.decodeUnknownEffect(VerdictComponentsSchema)(testedComponentsEncoded))

const decodeVerdict = (): Effect.Effect<VerdictEntry> =>
  Effect.orDie(
    S.decodeUnknownEffect(VerdictEntrySchema)({
      components: testedComponentsEncoded,
      status: 'Survived',
      coveredBy: ['adds two numbers'],
      costMs: 12,
      settledAt: 1_000,
    }),
  )

Feature('Answering an unreachable verdict byte store with an outcome instead of failing the run')
  .withLayer(unreachableStoreLayer)
  .body(({ scenario }) => {
    scenario(
      'A verdict read over a store that cannot be reached is answered as StoreUnavailable',
      Gherkin.Do.pipe(
        Given('a mutant whose verdict is stored behind a key')('components', () => decodeComponents()),
        When('the run reads the verdict stored behind that mutant')(
          'outcome',
          (s) => VerdictStore.use((store) => store.get(s.components)),
        ),
        Then('the store answers StoreUnavailable naming the failure reason')((s, expect) =>
          expect(s.outcome).toEqual(StoreUnavailable.make({ reason: UNAVAILABLE_REASON }))
        ),
      ),
    )

    scenario(
      'A mutant listing over a store that cannot be reached is answered as StoreUnavailable',
      Gherkin.Do.pipe(
        Given('a mutant with entries in the store')('mutantId', () => Effect.succeed(MUTANT_ID)),
        When('the run lists the entries stored under that mutant')(
          'outcome',
          (s) => VerdictStore.use((store) => store.list(s.mutantId)),
        ),
        Then('the store answers StoreUnavailable naming the failure reason')((s, expect) =>
          expect(s.outcome).toEqual(StoreUnavailable.make({ reason: UNAVAILABLE_REASON }))
        ),
      ),
    )

    scenario(
      'A verdict write over a store that cannot be reached is answered as a skipped put',
      Gherkin.Do.pipe(
        Given('a settled verdict ready to be stored')('verdict', () => decodeVerdict()),
        When('the run stores that verdict')('outcome', (s) => VerdictStore.use((store) => store.put(s.verdict))),
        Then('the store answers PutSkipped naming the failure reason')((s, expect) =>
          expect(s.outcome).toEqual(PutSkipped.make({ reason: UNAVAILABLE_REASON }))
        ),
      ),
    )
  })
