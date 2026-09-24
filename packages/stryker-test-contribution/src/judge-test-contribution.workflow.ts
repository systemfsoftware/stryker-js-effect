import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type * as schema from '@systemfsoftware/stryker-js-plugin-interface'

import type { ContributionEntry, ReportView, TestFileContribution } from './test-contribution.schema.js'
import { TestFileContributionSchema } from './test-contribution.schema.js'

export class JudgeTestContribution extends S.TaggedClass<JudgeTestContribution>()('JudgeTestContribution', {
  report: S.Struct({
    files: S.Record(
      S.String,
      S.Struct({
        language: S.String,
        source: S.String,
        mutants: S.Array(
          S.Struct({
            id: S.String,
            status: S.Union([S.Literal('Killed'), S.Literal('Timeout'), S.Literal('Ignored')]),
            killedBy: S.optional(S.Array(S.String)),
            coveredBy: S.optional(S.Array(S.String)),
          }),
        ),
      }),
    ),
    testFiles: S.optional(S.Record(S.String, S.Struct({ tests: S.Array(S.Struct({ id: S.String })) }))),
  }),
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

type TestFileById = ReadonlyMap<string, string>

const KILLING_STATUSES: Readonly<Record<string, true>> = { Killed: true, Timeout: true }

const PRECISION = 'every killing test was recorded'

const testFilesOf = (report: ReportView): Record<string, TestFileMapEntry> => report.testFiles ?? {}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined

const testFileById = (testFiles: Record<string, TestFileMapEntry>): TestFileById =>
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
    totalKills: countBy(kills.flatMap((kill) => [...kill.killers])),
    killableCovered: countBy(
      mutants.filter(isKillableMutant).flatMap((mutant) => [...realCoverersOf(mutant, fileById)]),
    ),
    unattributed: new Set(kills.filter(isUnattributedKill).flatMap((kill) => [...kill.coverers])),
  }
}
const contributionOf = (report: ReportView): ReadonlyMap<string, TestFileContribution> => {
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

const toothlessOf = (
  contribution: ReadonlyMap<string, TestFileContribution>,
  suffixes: readonly string[],
  everyKillerRecorded: boolean,
): readonly string[] =>
  [...contribution]
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
  const contribution = contributionOf(command.report)
  const kills = killsOf(mutantsOf(command.report), testFileById(testFilesOf(command.report)))
  return {
    matches: command.suffixes.join(', '),
    everyKillerRecorded: command.everyKillerRecorded,
    contribution: [...contribution],
    inScope: [...contribution].filter(([fileName]) => isInScope(fileName, command.suffixes)),
    toothless: toothlessOf(contribution, command.suffixes, command.everyKillerRecorded),
    kills: kills.map((kill) => ({ killers: [...kill.killers] })),
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
  ...partOf(inScope.filter((entry) => categoryOf(entry) === 'sole').length, 'judged (kill a mutant nothing else kills)'),
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
  Match.value(killers.length).pipe(
    Match.when(0, () => true),
    Match.orElse(() => hasKillerOutside(killers, accused)),
  )

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
          message: `This run credited no kill to any test file, so no test file's contribution to it can be measured. Until that is fixed the ${judgement.inScope.length} file(s) matching ${judgement.matches} are unjudged, not cleared.`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.tag('runReviewed', () => reviewedOf(judgement)),
    Match.tag('jointlyDeletable', () =>
      Result.succeed(
        JointlyDeletable.make({
          failed: true as const,
          message: `Deleting these ${judgement.toothless.length} test file(s) would leave every mutant just as dead (${PRECISION}):\n${bulletedFiles(judgement.toothless)}`,
          contribution: judgement.contribution,
          toothless: judgement.toothless,
        }),
      )),
    Match.tag('notJointlyDeletable', () =>
      Result.succeed(
        NotJointlyDeletable.make({
          failed: true as const,
          message: `Deleting these ${judgement.toothless.length} test file(s) together would not leave every mutant just as dead: some mutant only they kill would be resurrected (${PRECISION}). Each is individually redundant, but the joint claim is not made on this evidence:\n${bulletedFiles(judgement.toothless)}`,
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
