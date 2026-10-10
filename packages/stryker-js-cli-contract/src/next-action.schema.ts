import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as SchemaTransformation from 'effect/SchemaTransformation'

const SHOWN_TESTS = 3

const NamedTestsSchema = S.Struct({ total: Report.NonNegativeInt, shown: S.Array(S.String) })
type NamedTests = typeof NamedTestsSchema.Type

const showsTheFirstOfTotal = (tests: NamedTests): boolean => tests.shown.length === Math.min(SHOWN_TESTS, tests.total)

const shownCapped = (tests: NamedTests): NamedTests => {
  const shown = tests.shown.slice(0, SHOWN_TESTS)
  return { shown, total: shown.length < SHOWN_TESTS ? shown.length : Math.max(tests.total, SHOWN_TESTS) }
}

const ShownFirstOfTotal = S.declare(
  (value: unknown): value is NamedTests => S.is(NamedTestsSchema)(value) && showsTheFirstOfTotal(value),
  {
    expected: `a shown list of min(${SHOWN_TESTS}, total) test names`,
    toCodecArbitrary: () =>
      S.link<NamedTests>()(NamedTestsSchema, {
        decode: SchemaGetter.transform(shownCapped),
        encode: SchemaGetter.transform((tests: NamedTests) => tests),
      }),
  },
)

export const NextActionTests = NamedTestsSchema.pipe(
  S.decodeTo(ShownFirstOfTotal, SchemaTransformation.passthrough()),
).annotate({
  description:
    `The tests an action names: \`total\` counts them all and \`shown\` holds the first ${SHOWN_TESTS}. The full list is the mutant's \`coveredBy\`.`,
})
export type NextActionTests = typeof NextActionTests.Type

export const StrengthenTests = S.TaggedStruct('strengthen-tests', {
  tests: NextActionTests,
  reproduce: S.String,
}).annotate({
  description:
    'The covering tests ran and none failed: strengthen an assertion in one of `tests`, then run `reproduce` to check that it kills the mutant.',
})
export type StrengthenTests = typeof StrengthenTests.Type

export const AddTest = S.TaggedStruct('add-test', {
  file: S.toType(Mutant.CanonicalFileName),
  line: Mutant.Line,
  column: Mutant.Column,
}).annotate({ description: 'No test executes the mutant: add a test that reaches `file` at `line` and `column`.' })
export type AddTest = typeof AddTest.Type

export const NoneNeededWhy = S.Literals(['timeout-counts-as-detected', 'runtime-error-excluded-from-score'])
  .mapMembers((members) => [
    members[0].annotate({ description: 'A Timeout counts as detected, so the mutant needs no new test.' }),
    members[1].annotate({ description: 'A RuntimeError is left out of the score, so the mutant needs no new test.' }),
  ])
export type NoneNeededWhy = typeof NoneNeededWhy.Type

export const NoneNeeded = S.TaggedStruct('none-needed', { why: NoneNeededWhy }).annotate({
  description: 'The mutant needs no action; `why` says which rule exempts it.',
})
export type NoneNeeded = typeof NoneNeeded.Type

export const FixFailingTest = S.TaggedStruct('fix-failing-test', { tests: NextActionTests }).annotate({
  description: 'Tests failed without any mutant active: fix `tests`, then run again.',
})
export type FixFailingTest = typeof FixFailingTest.Type

export const FixConfig = S.TaggedStruct('fix-config', { remediation: S.String }).annotate({
  description: 'The configuration or a plugin is wrong: apply `remediation`, then run again.',
})
export type FixConfig = typeof FixConfig.Type

export const RerunShards = S.TaggedStruct('rerun-shards', { shards: S.Array(S.Int) }).annotate({
  description: 'Shard reports are missing or overlap: re-run the 1-based shard indexes in `shards` from one plan.',
})
export type RerunShards = typeof RerunShards.Type

export const RunMutation = S.TaggedStruct('run-mutation', { command: S.String }).annotate({
  description: 'No report holds the answer yet: run `command`.',
})
export type RunMutation = typeof RunMutation.Type

export const ListSurvivors = S.TaggedStruct('list-survivors', { command: S.String }).annotate({
  description: 'The survivors are listed elsewhere: run `command` to page through them.',
})
export type ListSurvivors = typeof ListSurvivors.Type

export const RestartPaging = S.TaggedStruct('restart-paging', { command: S.String }).annotate({
  description: 'The page cursor no longer applies: run `command` to page from the start.',
})
export type RestartPaging = typeof RestartPaging.Type

export const NextAction = S.Union([
  StrengthenTests,
  AddTest,
  NoneNeeded,
  FixFailingTest,
  FixConfig,
  RerunShards,
  RunMutation,
  ListSurvivors,
  RestartPaging,
]).annotate({ description: 'What an agent does next about a mutant or a failed run, as one closed set.' })
  .pipe(S.toTaggedUnion('_tag'))
export type NextAction = typeof NextAction.Type

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const acceptsTests = S.is(NextActionTests)
  const totalSeeds = [0, 1, 2, 3, 4]
  const shownSeeds: ReadonlyArray<ReadonlyArray<string>> = [[], ['a'], ['a', 'b'], ['a', 'b', 'c'], [
    'a',
    'b',
    'c',
    'd',
  ]]
  const namesExactlyTheFirstThree = (total: number, shown: ReadonlyArray<string>): boolean =>
    total < SHOWN_TESTS ? shown.length === total : shown.length === SHOWN_TESTS

  it.prop(
    '∀t_NextActionTestsRefusal_≡ShownIsTheFirstThreeOfTotal',
    { of: [Report.NonNegativeInt, S.Array(S.String)], subject: acceptsTests },
    (subject, [drawnTotal, drawnShown]) =>
      Arr.every(
        Arr.append(totalSeeds, drawnTotal),
        (total) =>
          Arr.every(Arr.append(shownSeeds, drawnShown), (shown) =>
            subject({ total, shown }) === namesExactlyTheFirstThree(total, shown)),
      ),
  )
}
