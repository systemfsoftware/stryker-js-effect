import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type ReuseReport,
  ReuseReportSchema,
  type ReuseTestFiles,
  ReuseTestFilesSchema,
} from '../IncrementalDiff.schema.js'
import { type ReportTestId, reportTestIds, ResolveReportTestIds } from '../report-test-ids.workflow.js'

const testFilesArb = Arbitrary.schema(ReuseTestFilesSchema)
const attributedIdsArb = Arbitrary.schema(S.Array(S.String))

const MUTANT_ID = Mutant.MutantId.make('00000000000000ab')

const runnerTestIdOf = (file: string, name: string): string => `${file}#${name}`

interface ListedTest {
  readonly positionalId: string
  readonly runnerTestId: string
}

const listedTestsOf = (testFiles: ReuseTestFiles): readonly ListedTest[] =>
  Object.entries(testFiles).flatMap(([file, testFile]) =>
    testFile.tests.map((test) => ({ positionalId: test.id, runnerTestId: runnerTestIdOf(file, test.name) }))
  )

const reportOf = (testFiles: ReuseTestFiles, attributedIds: readonly string[]): ReuseReport => ({
  verdictSemanticsVersion: 1,
  mutantSetPolicy: 'default',
  runInputsDigest: 'run-inputs',
  files: {
    'src/subject.ts': {
      mutants: [
        { id: MUTANT_ID, status: 'Killed', killedBy: [...attributedIds], coveredBy: [...attributedIds] },
      ],
    },
  },
  testFiles,
})

const persistedOf = (report: ReuseReport): Option.Option<ReuseReport> =>
  Option.flatMap(
    S.encodeOption(ReuseReportSchema)(report),
    (encoded) => S.decodeOption(S.fromJsonString(ReuseReportSchema))(JSON.stringify(encoded)),
  )

const pairsOf = (subject: typeof reportTestIds, report: ReuseReport): readonly ReportTestId[] =>
  Result.getOrThrow(
    subject(ResolveReportTestIds.make(report.testFiles === undefined ? {} : { testFiles: report.testFiles })),
  )

const byCodeUnit = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const sortedRunnerTestIdsOf = (tests: readonly ListedTest[], positionalId: string): readonly string[] =>
  tests
    .filter((test) => test.positionalId === positionalId)
    .map((test) => test.runnerTestId)
    .sort(byCodeUnit)

const resolvedRunnerTestIdsOf = (pairs: readonly ReportTestId[], positionalId: string): readonly string[] =>
  pairs
    .filter((pair) => pair.positionalId === positionalId)
    .map((pair) => pair.runnerTestId)
    .sort(byCodeUnit)

const resolvesLikeTheListedTests = (
  testFiles: ReuseTestFiles,
  attributedIds: readonly string[],
  pairs: readonly ReportTestId[],
): boolean => {
  const listed = listedTestsOf(testFiles)
  const ids = [...new Set([...listed.map((test) => test.positionalId), ...attributedIds])]
  return ids.every((positionalId) =>
    JSON.stringify(resolvedRunnerTestIdsOf(pairs, positionalId)) ===
      JSON.stringify(sortedRunnerTestIdsOf(listed, positionalId))
  )
}

describe('reportTestIds', () => {
  it.prop(
    '∀tkm_ListedTestsAndMutantAttributions_≡APersistedReportRestoresTheListedRunnerTestIds',
    { of: [testFilesArb, attributedIdsArb], subject: reportTestIds },
    (subject, [testFiles, attributedIds]) => {
      const persisted = persistedOf(reportOf(testFiles, attributedIds))
      return Option.match(persisted, {
        onNone: () => false,
        onSome: (report) => resolvesLikeTheListedTests(testFiles, attributedIds, pairsOf(subject, report)),
      })
    },
  )
})
