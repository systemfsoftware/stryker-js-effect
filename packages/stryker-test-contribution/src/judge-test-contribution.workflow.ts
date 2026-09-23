import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type { TestFileContribution } from './test-contribution.schema.js'
import { TestFileContributionSchema } from './test-contribution.schema.js'

/**
 * The evidence one judging pass saw, gathered before the rules run: the matched
 * suffixes as they name the gate, the contribution table keyed by file name, the
 * in-scope entries, the accused (toothless) files, whether every killing test was
 * recorded, and every kill's credited killers.
 */
export class JudgeTestContribution extends S.TaggedClass<JudgeTestContribution>()('JudgeTestContribution', {
  matches: S.String,
  everyKillerRecorded: S.Boolean,
  contribution: S.Array(S.Tuple([S.String, TestFileContributionSchema])),
  inScope: S.Array(S.Tuple([S.String, TestFileContributionSchema])),
  toothless: S.Array(S.String),
  kills: S.Array(S.Struct({ killers: S.Array(S.String) })),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    matches: 'stryker.test_contribution.matches',
    everyKillerRecorded: 'stryker.test_contribution.every_killer_recorded',
  } as const
}

const VerdictTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-test-contribution/TestContributionVerdict')
type VerdictTypeId = typeof VerdictTypeId

export class RunUnjudged extends S.TaggedClass<RunUnjudged>()('RunUnjudged', {
  failed: S.Literal(false),
  message: S.String,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class BailHidesKillers extends S.TaggedClass<BailHidesKillers>()('BailHidesKillers', {
  failed: S.Literal(true),
  message: S.String,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class NoKillCredited extends S.TaggedClass<NoKillCredited>()('NoKillCredited', {
  failed: S.Literal(true),
  message: S.String,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class RunReviewed extends S.TaggedClass<RunReviewed>()('RunReviewed', {
  failed: S.Literal(false),
  message: S.String,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class JointlyDeletable extends S.TaggedClass<JointlyDeletable>()('JointlyDeletable', {
  failed: S.Literal(true),
  message: S.String,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

export class NotJointlyDeletable extends S.TaggedClass<NotJointlyDeletable>()('NotJointlyDeletable', {
  failed: S.Literal(true),
  message: S.String,
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

type ContributionEntry = readonly [string, TestFileContribution]

interface Judgement {
  readonly matches: string
  readonly everyKillerRecorded: boolean
  readonly contribution: readonly ContributionEntry[]
  readonly inScope: readonly ContributionEntry[]
  readonly toothless: readonly string[]
  readonly kills: readonly { readonly killers: readonly string[] }[]
}

const PRECISION = 'every killing test was recorded'

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
        }),
      )),
    Match.when(false, () =>
      Result.succeed(
        RunReviewed.make({
          failed: false as const,
          message: `Every file matching ${judgement.matches} was reviewed: ${countsOf(judgement.inScope).join('; ')}.`,
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
const ruleOf = (command: JudgeTestContribution): JudgingRule =>
  Match.value(command).pipe(
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

const decisionOf = (command: JudgeTestContribution): Result.Result<TestContributionDecision, never> =>
  Match.value(ruleOf(command)).pipe(
    Match.tag('runUnjudged', () =>
      Result.succeed(
        RunUnjudged.make({
          failed: false as const,
          message: `No test file matching ${command.matches} ran, so none was judged.`,
        }),
      )),
    Match.tag('bailHidesKillers', () =>
      Result.succeed(
        BailHidesKillers.make({
          failed: true as const,
          message:
            `This run used Stryker's bail mode, which stops each mutant at its first killing test. A test file's contribution therefore cannot be measured on this evidence. Set \`disableBail: true\` to record every killing test, or remove the test-contribution plugin from \`plugins\` to turn the check off for this run.`,
        }),
      )),
    Match.tag('noKillCredited', () =>
      Result.succeed(
        NoKillCredited.make({
          failed: true as const,
          message: `This run credited no kill to any test file, so no test file's contribution to it can be measured. Until that is fixed the ${command.inScope.length} file(s) matching ${command.matches} are unjudged, not cleared.`,
        }),
      )),
    Match.tag('runReviewed', () => reviewedOf(command)),
    Match.tag('jointlyDeletable', () =>
      Result.succeed(
        JointlyDeletable.make({
          failed: true as const,
          message: `Deleting these ${command.toothless.length} test file(s) would leave every mutant just as dead (${PRECISION}):\n${bulletedFiles(command.toothless)}`,
        }),
      )),
    Match.tag('notJointlyDeletable', () =>
      Result.succeed(
        NotJointlyDeletable.make({
          failed: true as const,
          message: `Deleting these ${command.toothless.length} test file(s) together would not leave every mutant just as dead: some mutant only they kill would be resurrected (${PRECISION}). Each is individually redundant, but the joint claim is not made on this evidence:\n${bulletedFiles(command.toothless)}`,
        }),
      )),
    Match.exhaustive,
  )

export const judgeTestContribution = Workflow.make({
  command: JudgeTestContribution,
  decision: S.Union([
    RunUnjudged,
    BailHidesKillers,
    NoKillCredited,
    RunReviewed,
    JointlyDeletable,
    NotJointlyDeletable,
  ]),
  error: S.Never,
  decide: decisionOf,
})
