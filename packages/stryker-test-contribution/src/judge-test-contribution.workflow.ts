import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Array from 'effect/Array'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { Report } from '@systemfsoftware/stryker-js-plugin-interface'

import type { ContributionEntry, TestFileContribution } from './test-contribution.schema.js'
import { TestFileContributionSchema } from './test-contribution.schema.js'

export class JudgeTestContribution extends S.TaggedClass<JudgeTestContribution>()('JudgeTestContribution', {
  report: Report.MutationTestResultSchema,
  everyKillerRecorded: S.Boolean,
  suffixes: S.Array(S.String),
}) {
  static readonly defaultRequireTestContributionSuffixes = [
    '.workflow.property.test.ts',
    '.policy.property.test.ts',
    '.kernel.property.test.ts',
  ] as const

  static readonly [Workflow.InstrumentationBrand] = {
    everyKillerRecorded: 'stryker.test_contribution.every_killer_recorded',
  } as const
}

const VerdictTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-test-contribution/TestContributionVerdict')
type VerdictTypeId = typeof VerdictTypeId

const verdictFields = {
  contribution: S.Array(S.Tuple([S.String, TestFileContributionSchema])),
  toothless: S.Array(S.String),
}

export class RunUnjudged extends S.TaggedClass<RunUnjudged>()('RunUnjudged', {
  failed: S.Literal(false),
  message: S.String,
  ...verdictFields,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class BailHidesKillers extends S.TaggedClass<BailHidesKillers>()('BailHidesKillers', {
  failed: S.Literal(true),
  message: S.String,
  ...verdictFields,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class NoKillCredited extends S.TaggedClass<NoKillCredited>()('NoKillCredited', {
  failed: S.Literal(true),
  message: S.String,
  ...verdictFields,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class RunReviewed extends S.TaggedClass<RunReviewed>()('RunReviewed', {
  failed: S.Literal(false),
  message: S.String,
  ...verdictFields,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class JointlyDeletable extends S.TaggedClass<JointlyDeletable>()('JointlyDeletable', {
  failed: S.Literal(true),
  message: S.String,
  ...verdictFields,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class NotJointlyDeletable extends S.TaggedClass<NotJointlyDeletable>()('NotJointlyDeletable', {
  failed: S.Literal(true),
  message: S.String,
  ...verdictFields,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export const TestContributionDecision = S.Union([
  RunUnjudged,
  BailHidesKillers,
  NoKillCredited,
  RunReviewed,
  JointlyDeletable,
  NotJointlyDeletable,
])
export type TestContributionDecision = typeof TestContributionDecision.Type

type TestFileById = HashMap.HashMap<string, string>

const KILLING_STATUSES: Readonly<Record<string, true>> = { Killed: true, Timeout: true }

const PRECISION = 'every killing test was recorded'

const noTestFiles: Record<string, Report.TestFile> = {}

const testFilesOf = (report: Report.MutationTestResult): Record<string, Report.TestFile> =>
  Option.getOrElse(Option.fromUndefinedOr(report.testFiles), () => noTestFiles)

const testFileById = (testFiles: Record<string, Report.TestFile>): TestFileById =>
  Array.reduce(
    Object.entries(testFiles).flatMap(([fileName, testFile]): ReadonlyArray<readonly [string, string]> =>
      testFile.tests.map((test): readonly [string, string] => [test.id, fileName])
    ),
    HashMap.empty<string, string>(),
    (byId, [testId, fileName]) => HashMap.set(byId, testId, fileName),
  )

const idsOf = (testIds: readonly string[] | undefined): readonly string[] =>
  Option.getOrElse(Option.fromUndefinedOr(testIds), () => [])

const fileNameOf = (fileById: TestFileById, testId: string): Option.Option<string> => HashMap.get(fileById, testId)

const keepReal = (fileById: TestFileById) => (testId: string): ReadonlyArray<string> =>
  Option.match(fileNameOf(fileById, testId), { onNone: () => [], onSome: (fileName) => [fileName] })

const realFiles = (testIds: readonly string[], fileById: TestFileById): ReadonlyArray<string> =>
  Array.dedupe(testIds.flatMap(keepReal(fileById)))

const killersOf = (killedBy: readonly string[], fileById: TestFileById): ReadonlyArray<string> =>
  Array.dedupe(
    killedBy.map((testId) => Option.getOrElse(fileNameOf(fileById, testId), () => testId)),
  )

const isKillingMutant = (mutant: Report.MutantResult): boolean => KILLING_STATUSES[mutant.status] === true

const isKillableMutant = (mutant: Report.MutantResult): boolean => mutant.status !== 'Ignored'

const realKillersOf = (mutant: Report.MutantResult, fileById: TestFileById): ReadonlyArray<string> =>
  realFiles(idsOf(mutant.killedBy), fileById)

const realCoverersOf = (mutant: Report.MutantResult, fileById: TestFileById): ReadonlyArray<string> =>
  realFiles(idsOf(mutant.coveredBy), fileById)

interface Kill {
  readonly killers: ReadonlyArray<string>
  readonly coverers: ReadonlyArray<string>
  readonly claimedAlone: boolean
}

const killOf = (mutant: Report.MutantResult, fileById: TestFileById): Kill => ({
  killers: realKillersOf(mutant, fileById),
  coverers: realCoverersOf(mutant, fileById),
  claimedAlone: killersOf(idsOf(mutant.killedBy), fileById).length === 1,
})

const mutantsOf = (report: Report.MutationTestResult): readonly Report.MutantResult[] =>
  Object.values(report.files).flatMap((file) => file.mutants)

const killsOf = (mutants: readonly Report.MutantResult[], fileById: TestFileById): readonly Kill[] =>
  mutants.filter(isKillingMutant).map((mutant) => killOf(mutant, fileById))

const isUnattributedKill = (kill: Kill): boolean => kill.killers.length === 0

const countOf = (counts: HashMap.HashMap<string, number>, fileName: string): number =>
  Option.getOrElse(HashMap.get(counts, fileName), () => 0)

const countBy = (fileNames: ReadonlyArray<string>): HashMap.HashMap<string, number> =>
  Array.reduce(
    fileNames,
    HashMap.empty<string, number>(),
    (counts, fileName) => HashMap.set(counts, fileName, 1 + Option.getOrElse(HashMap.get(counts, fileName), () => 0)),
  )

interface ContributionTally {
  readonly soleKills: HashMap.HashMap<string, number>
  readonly totalKills: HashMap.HashMap<string, number>
  readonly killableCovered: HashMap.HashMap<string, number>
  readonly unattributed: HashSet.HashSet<string>
}

const tallyOf = (mutants: readonly Report.MutantResult[], fileById: TestFileById): ContributionTally => {
  const kills = killsOf(mutants, fileById)
  return {
    soleKills: countBy(kills.filter((kill) => kill.claimedAlone).flatMap((kill) => kill.killers)),
    totalKills: countBy(kills.flatMap((kill) => kill.killers)),
    killableCovered: countBy(
      mutants.filter(isKillableMutant).flatMap((mutant) => realCoverersOf(mutant, fileById)),
    ),
    unattributed: HashSet.fromIterable(kills.filter(isUnattributedKill).flatMap((kill) => kill.coverers)),
  }
}
const fileContributionOf = (fileName: string, tally: ContributionTally): TestFileContribution => ({
  soleKills: countOf(tally.soleKills, fileName),
  totalKills: countOf(tally.totalKills, fileName),
  killableCovered: countOf(tally.killableCovered, fileName),
  coversUnattributedKill: HashSet.has(tally.unattributed, fileName),
})

const contributionOf = (
  report: Report.MutationTestResult,
  fileById: TestFileById,
): ReadonlyArray<ContributionEntry> => {
  const testFiles = testFilesOf(report)
  const tally = tallyOf(mutantsOf(report), fileById)
  return Object.keys(testFiles).map((fileName): ContributionEntry => [
    fileName,
    fileContributionOf(fileName, tally),
  ])
}

const isInScope = (fileName: string, suffixes: readonly string[]): boolean =>
  suffixes.some((suffix) => fileName.endsWith(suffix))

const defends = (entry: TestFileContribution, everyKillerRecorded: boolean): boolean =>
  Match.value(everyKillerRecorded).pipe(
    Match.when(true, () => entry.soleKills > 0),
    Match.when(false, () => entry.totalKills > 0),
    Match.exhaustive,
  )

const toothlessOf = (
  contribution: ReadonlyArray<ContributionEntry>,
  suffixes: readonly string[],
  everyKillerRecorded: boolean,
): readonly string[] =>
  contribution
    .filter(([fileName]) => isInScope(fileName, suffixes))
    .filter(([, entry]) => !defends(entry, everyKillerRecorded))
    .filter(([, entry]) => entry.killableCovered > 0)
    .filter(([, entry]) => !entry.coversUnattributedKill)
    .map(([fileName]) => fileName)
    .sort()

interface Judgement {
  readonly matches: string
  readonly everyKillerRecorded: boolean
  readonly contribution: readonly ContributionEntry[]
  readonly inScope: readonly ContributionEntry[]
  readonly toothless: readonly string[]
  readonly kills: readonly { readonly killers: readonly string[] }[]
}

const judgementOf = (command: JudgeTestContribution): Judgement => {
  const fileById = testFileById(testFilesOf(command.report))
  const contribution = contributionOf(command.report, fileById)
  const kills = killsOf(mutantsOf(command.report), fileById)
  return {
    matches: command.suffixes.join(', '),
    everyKillerRecorded: command.everyKillerRecorded,
    contribution,
    inScope: contribution.filter(([fileName]) => isInScope(fileName, command.suffixes)),
    toothless: toothlessOf(contribution, command.suffixes, command.everyKillerRecorded),
    kills: kills.map((kill) => ({ killers: kill.killers })),
  }
}

const bulletedFiles = (fileNames: readonly string[]): string =>
  fileNames.map((fileName) => `  - ${fileName}`).join('\n')

const creditedAnyKill = (contribution: readonly ContributionEntry[]): boolean =>
  contribution.some(([, entry]) => entry.totalKills > 0)

const partOf = (count: number, label: string): readonly string[] =>
  Match.value(count > 0).pipe(
    Match.when(true, (): readonly string[] => [`${count} ${label}`]),
    Match.when(false, (): readonly string[] => []),
    Match.exhaustive,
  )

const holdsSoleKill = (entry: ContributionEntry): boolean => entry[1].soleKills > 0

const categoryOf = (entry: ContributionEntry): 'sole' | 'exempt' | 'unjudged' =>
  Match.value([holdsSoleKill(entry), entry[1].coversUnattributedKill] as const).pipe(
    Match.when([true, true], () => 'sole' as const),
    Match.when([true, false], () => 'sole' as const),
    Match.when([false, true], () => 'exempt' as const),
    Match.when([false, false], () => 'unjudged' as const),
    Match.exhaustive,
  )

const countsOf = (inScope: readonly ContributionEntry[]): readonly string[] => [
  ...partOf(
    inScope.filter((entry) => categoryOf(entry) === 'sole').length,
    'judged (kill a mutant nothing else kills)',
  ),
  ...partOf(
    inScope.filter((entry) => categoryOf(entry) === 'exempt').length,
    'exempted (cover a kill attributed to no test file)',
  ),
  ...partOf(
    inScope.filter((entry) => categoryOf(entry) === 'unjudged').length,
    'unjudged (offered no killable, covered mutant)',
  ),
]

const hasKillerOutside = (killers: readonly string[], accused: readonly string[]): boolean =>
  killers.some((fileName) => !accused.includes(fileName))

const escapesAccused = (killers: readonly string[], accused: readonly string[]): boolean =>
  Array.match(killers, {
    onEmpty: () => true,
    onNonEmpty: (nonEmpty) => hasKillerOutside(nonEmpty, accused),
  })

const isJointlySubsumed = (
  kills: readonly { readonly killers: readonly string[] }[],
  accused: readonly string[],
): boolean => kills.every((kill) => escapesAccused(kill.killers, accused))

const reviewedOf = (judgement: Judgement): Result.Result<TestContributionDecision, never> =>
  Match.value(judgement.inScope.every(([, entry]) => entry.soleKills > 0)).pipe(
    Match.when(true, () =>
      Result.succeed(
        RunReviewed.make({
          failed: false as const,
          message: `Every test file matching ${judgement.matches} kills a mutant nothing else kills (${PRECISION}).`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.when(false, () =>
      Result.succeed(
        RunReviewed.make({
          failed: false as const,
          message: `Every file matching ${judgement.matches} was reviewed: ${countsOf(judgement.inScope).join('; ')}.`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.exhaustive,
  )

const RunUnjudgedRule = S.TaggedStruct('runUnjudged', {})
const BailHidesKillersRule = S.TaggedStruct('bailHidesKillers', {})
const NoKillCreditedRule = S.TaggedStruct('noKillCredited', {})
const RunReviewedRule = S.TaggedStruct('runReviewed', {})
const JointlyDeletableRule = S.TaggedStruct('jointlyDeletable', {})
const NotJointlyDeletableRule = S.TaggedStruct('notJointlyDeletable', {})

const JudgingRule = S.Union([
  RunUnjudgedRule,
  BailHidesKillersRule,
  NoKillCreditedRule,
  RunReviewedRule,
  JointlyDeletableRule,
  NotJointlyDeletableRule,
])
type JudgingRule = S.Schema.Type<typeof JudgingRule>
const ruleOf = (judgement: Judgement): JudgingRule =>
  Match.value(judgement).pipe(
    Match.when(
      (self) => self.inScope.length === 0,
      () => RunUnjudgedRule.make({}),
    ),
    Match.when(
      (self) => !self.everyKillerRecorded,
      () => BailHidesKillersRule.make({}),
    ),
    Match.when(
      (self) => !creditedAnyKill(self.contribution),
      () => NoKillCreditedRule.make({}),
    ),
    Match.when(
      (self) => self.toothless.length === 0,
      () => RunReviewedRule.make({}),
    ),
    Match.when(
      (self) => isJointlySubsumed(self.kills, self.toothless),
      () => JointlyDeletableRule.make({}),
    ),
    Match.orElse(() => NotJointlyDeletableRule.make({})),
  )

const decisionOf = (judgement: Judgement): Result.Result<TestContributionDecision, never> =>
  Match.value(ruleOf(judgement)).pipe(
    Match.tag('runUnjudged', () =>
      Result.succeed(
        RunUnjudged.make({
          failed: false as const,
          message: `No test file matching ${judgement.matches} ran, so none was judged.`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.tag('bailHidesKillers', () =>
      Result.succeed(
        BailHidesKillers.make({
          failed: true as const,
          message:
            `This run used Stryker's bail mode, which stops each mutant at its first killing test. A test file's contribution therefore cannot be measured on this evidence. Set \`disableBail: true\` to record every killing test, or remove the test-contribution plugin from \`plugins\` to turn the check off for this run.`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.tag('noKillCredited', () =>
      Result.succeed(
        NoKillCredited.make({
          failed: true as const,
          message:
            `This run credited no kill to any test file, so no test file's contribution to it can be measured. Until that is fixed the ${judgement.inScope.length} file(s) matching ${judgement.matches} are unjudged, not cleared.`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.tag('runReviewed', () => reviewedOf(judgement)),
    Match.tag('jointlyDeletable', () =>
      Result.succeed(
        JointlyDeletable.make({
          failed: true as const,
          message:
            `Deleting these ${judgement.toothless.length} test file(s) would leave every mutant just as dead (${PRECISION}):\n${
              bulletedFiles(judgement.toothless)
            }`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.tag('notJointlyDeletable', () =>
      Result.succeed(
        NotJointlyDeletable.make({
          failed: true as const,
          message:
            `Deleting these ${judgement.toothless.length} test file(s) together would not leave every mutant just as dead: some mutant only they kill would be resurrected (${PRECISION}). Each is individually redundant, but the joint claim is not made on this evidence:\n${
              bulletedFiles(judgement.toothless)
            }`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.exhaustive,
  )

const decide = (command: JudgeTestContribution): Result.Result<TestContributionDecision, never> =>
  decisionOf(judgementOf(command))

export const judgeTestContribution = Workflow.make({
  command: JudgeTestContribution,
  decision: TestContributionDecision,
  error: S.Never,
  decide,
})
