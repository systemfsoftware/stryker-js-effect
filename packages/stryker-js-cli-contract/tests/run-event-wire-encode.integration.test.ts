import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const SHARED_KEYS = [
  '_tag',
  'completed',
  'cost',
  'file',
  'id',
  'location',
  'mutator',
  'replacement',
  'static',
  'status',
  'statusReason',
  'subsumption',
  'total',
]

const COVERING = ['price.test.ts > adds']

const settledMutants = () => {
  const id = Mutant.MutantId.make('00000000000000b2')
  const fileName = S.toType(Mutant.CanonicalFileName).make('src/lib/price.ts')
  const location = { start: { line: 4, column: 10 }, end: { line: 4, column: 15 } }
  const shared = {
    _tag: 'mutantTested',
    id,
    fileName,
    location,
    mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
    replacement: 'a - b',
    static: false,
    cost: null,
    subsumption: null,
    completed: 1,
    total: 3,
  } as const
  return {
    killed: RunEvent.RunMutantTestedEvent.cases.Killed.make({
      ...shared,
      status: 'Killed',
      statusReason: 'killed: expected 1 to be 7',
      killedBy: COVERING,
    }),
    survived: RunEvent.RunMutantTestedEvent.cases.Survived.make({
      ...shared,
      status: 'Survived',
      statusReason: 'covered-not-killed: 1 covering tests ran, none failed',
      original: 'a + b',
      coveredBy: COVERING,
      next: RunEvent.nextActionOf({ id, file: fileName, location, coveredBy: COVERING }, 'Survived'),
    }),
    uncovered: RunEvent.RunMutantTestedEvent.cases.NoCoverage.make({
      ...shared,
      status: 'NoCoverage',
      statusReason: 'not-covered: no test reached the mutant',
      original: 'a + b',
      next: RunEvent.nextActionOf({ id, file: fileName, location, coveredBy: null }, 'NoCoverage'),
    }),
  }
}

const writtenKeysOf = (event: RunEvent.RunMutantTested): ReadonlyArray<string> | string => {
  const readLine = S.decodeUnknownResult(S.fromJsonString(S.Record(S.String, S.Unknown)))
  return Result.match(Result.flatMap(S.encodeResult(RunEvent.RunEventWireLine)(event), readLine), {
    onFailure: (error) => `refused: ${error.message}`,
    onSuccess: (line) => Object.keys(line).sort(),
  })
}

Feature('A settled mutant is written to the machine stream under the documented wire keys')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A killed mutant, a survivor and an uncovered mutant are written with the file and mutator keys and the facts of their status, nothing else',
      Gherkin.Do.pipe(
        Given('a killed mutant, a surviving mutant and an uncovered mutant settled by a run')(
          'events',
          () => Effect.sync(settledMutants),
        ),
        When('each mutant is written as a stream line')(
          'keys',
          (s) =>
            Effect.sync(() => ({
              killed: writtenKeysOf(s.events.killed),
              survived: writtenKeysOf(s.events.survived),
              uncovered: writtenKeysOf(s.events.uncovered),
            })),
        ),
        Then('each line names exactly the shared wire keys plus its status facts')((s, expect) =>
          expect(s.keys).toEqual({
            killed: [...SHARED_KEYS, 'killedBy'].sort(),
            survived: [...SHARED_KEYS, 'coveredBy', 'next', 'original'].sort(),
            uncovered: [...SHARED_KEYS, 'next', 'original'].sort(),
          })
        ),
      ),
    )
  })
