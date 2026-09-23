import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import type * as schema from '@systemfsoftware/stryker-js-plugin-interface'

import {
  judgeTestContribution as judgeTestContributionDecide,
  JudgeTestContribution,
  type TestContributionDecision,
} from './judge-test-contribution.workflow.js'
import type {
  ContributionEntry,
  ReportView,
  TestContributionInput,
  TestContributionVerdict,
  TestFileContribution,
} from './test-contribution.schema.js'

export const defaultRequireTestContributionSuffixes = [
  '.workflow.property.test.ts',
  '.policy.property.test.ts',
  '.kernel.property.test.ts',
] as const

type TestFileById = ReadonlyMap<string, string>

const KILLING_STATUSES: Readonly<Record<string, true>> = { Killed: true, Timeout: true }

const testFilesOf = (report: ReportView) => report.testFiles ?? {}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined

const testFileById = (testFiles: Readonly<Record<string, schema.TestFile>>): TestFileById =>
  new Map(
    Object.entries(testFiles).flatMap(([fileName, testFile]) =>
      testFile.tests.map((test): readonly [string, string] => [test.id, fileName]),
    ),
  )

const idsOf = (testIds: readonly string[] | undefined): readonly string[] => testIds ?? []

const realFiles = (testIds: readonly string[], fileById: TestFileById): ReadonlySet<string> =>
  new Set(testIds.map((testId) => fileById.get(testId)).filter(isDefined))

const killersOf = (killedBy: readonly string[], fileById: TestFileById): ReadonlySet<string> =>
  new Set(killedBy.map((testId) => fileById.get(testId) ?? testId))

const isKillingMutant = (mutant: schema.MutantResult): boolean => KILLING_STATUSES[mutant.status] === true

const isKillableMutant = (mutant: schema.MutantResult): boolean => mutant.status !== 'Ignored'

const realKillersOf = (mutant: schema.MutantResult, fileById: TestFileById): ReadonlySet<string> =>
  realFiles(idsOf(mutant.killedBy), fileById)

const realCoverersOf = (mutant: schema.MutantResult, fileById: TestFileById): ReadonlySet<string> =>
  realFiles(idsOf(mutant.coveredBy), fileById)

interface Kill {
  readonly killers: ReadonlySet<string>
  readonly coverers: ReadonlySet<string>
  readonly claimedAlone: boolean
}

const killOf = (mutant: schema.MutantResult, fileById: TestFileById): Kill => ({
  killers: realKillersOf(mutant, fileById),
  coverers: realCoverersOf(mutant, fileById),
  claimedAlone: killersOf(idsOf(mutant.killedBy), fileById).size === 1,
})

const mutantsOf = (report: ReportView): readonly schema.MutantResult[] =>
  Object.values(report.files).flatMap((file) => file.mutants)

const killsOf = (mutants: readonly schema.MutantResult[], fileById: TestFileById): readonly Kill[] =>
  mutants.filter(isKillingMutant).map((mutant) => killOf(mutant, fileById))

const isUnattributedKill = (kill: Kill): boolean => kill.killers.size === 0

const countOf = (counts: ReadonlyMap<string, number>, fileName: string): number => counts.get(fileName) ?? 0

const incrementCount = (counts: Map<string, number>, fileName: string): Map<string, number> => {
  counts.set(fileName, countOf(counts, fileName) + 1)
  return counts
}

const countBy = (fileNames: Iterable<string>): ReadonlyMap<string, number> =>
  [...fileNames].reduce(incrementCount, new Map<string, number>())

interface ContributionTally {
  readonly soleKills: ReadonlyMap<string, number>
  readonly totalKills: ReadonlyMap<string, number>
  readonly killableCovered: ReadonlyMap<string, number>
  readonly unattributed: ReadonlySet<string>
}

const tallyOf = (mutants: readonly schema.MutantResult[], fileById: TestFileById): ContributionTally => {
  const kills = killsOf(mutants, fileById)
  return {
    soleKills: countBy(kills.filter((kill) => kill.claimedAlone).flatMap((kill) => [...kill.killers])),
    totalKills: countBy(kills.flatMap((kill) => [...kill.killers])),
    killableCovered: countBy(
      mutants.filter(isKillableMutant).flatMap((mutant) => [...realCoverersOf(mutant, fileById)]),
    ),
    unattributed: new Set(
      kills.filter(isUnattributedKill).flatMap((kill) => [...kill.coverers]),
    ),
  }
}

const fileContributionOf = (fileName: string, tally: ContributionTally): TestFileContribution => ({
  soleKills: countOf(tally.soleKills, fileName),
  totalKills: countOf(tally.totalKills, fileName),
  killableCovered: countOf(tally.killableCovered, fileName),
  coversUnattributedKill: tally.unattributed.has(fileName),
})

export const contributionByTestFile = (report: ReportView): ReadonlyMap<string, TestFileContribution> => {
  const testFiles = testFilesOf(report)
  const fileById = testFileById(testFiles)
  const tally = tallyOf(mutantsOf(report), fileById)
  return new Map(
    Object.keys(testFiles).map((fileName): ContributionEntry => [fileName, fileContributionOf(fileName, tally)]),
  )
}

const isInScope = (fileName: string, suffixes: readonly string[]): boolean =>
  suffixes.some((suffix) => fileName.endsWith(suffix))

const defends = (entry: TestFileContribution, everyKillerRecorded: boolean): boolean =>
  Match.value(everyKillerRecorded).pipe(
    Match.when(true, () => entry.soleKills > 0),
    Match.when(false, () => entry.totalKills > 0),
    Match.exhaustive,
  )

export const toothlessTestFiles: {
  (
    contribution: ReadonlyMap<string, TestFileContribution>,
    input: TestContributionInput,
  ): readonly string[]
  (input: TestContributionInput): (contribution: ReadonlyMap<string, TestFileContribution>) => readonly string[]
} = dual(
  2,
  (
    contribution: ReadonlyMap<string, TestFileContribution>,
    { suffixes, everyKillerRecorded }: TestContributionInput,
  ): readonly string[] =>
    [...contribution]
      .filter(([fileName]) => isInScope(fileName, suffixes))
      .filter(([, entry]) => !defends(entry, everyKillerRecorded))
      .filter(([, entry]) => entry.killableCovered > 0)
      .filter(([, entry]) => !entry.coversUnattributedKill)
      .map(([fileName]) => fileName)
      .sort(),
)

const verdictOf = (decision: TestContributionDecision): TestContributionVerdict => ({
  failed: decision.failed,
  message: decision.message,
})

const commandOf = (
  report: ReportView,
  everyKillerRecorded: boolean,
  suffixes: readonly string[],
): JudgeTestContribution => {
  const testFiles = testFilesOf(report)
  const fileById = testFileById(testFiles)
  const contribution = contributionByTestFile(report)
  const kills = killsOf(mutantsOf(report), fileById)
  return JudgeTestContribution.make({
    matches: suffixes.join(', '),
    everyKillerRecorded,
    contribution: [...contribution],
    inScope: [...contribution].filter(([fileName]) => isInScope(fileName, suffixes)),
    toothless: toothlessTestFiles(contribution, { suffixes, everyKillerRecorded }),
    kills: kills.map((kill) => ({ killers: [...kill.killers] })),
  })
}

export const judgeTestContribution: {
  (report: ReportView, everyKillerRecorded: boolean, suffixes?: readonly string[]): TestContributionVerdict
  (
    everyKillerRecorded: boolean,
    suffixes?: readonly string[],
  ): (report: ReportView) => TestContributionVerdict
} = dual(
  (args) => typeof args[0] !== 'boolean',
  (
    report: ReportView,
    everyKillerRecorded: boolean,
    suffixes: readonly string[] = defaultRequireTestContributionSuffixes,
  ): TestContributionVerdict =>
    verdictOf(
      judgeTestContributionDecide(commandOf(report, everyKillerRecorded, suffixes)).pipe(Result.merge),
    ),
)
