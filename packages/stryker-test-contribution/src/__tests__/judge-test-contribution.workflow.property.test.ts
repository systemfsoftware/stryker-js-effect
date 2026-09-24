import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { Arbitrary } from 'effect/unstable'

import {
  BailHidesKillers,
  JointlyDeletable,
  judgeTestContribution,
  NoKillCredited,
  NotJointlyDeletable,
  RunReviewed,
  RunUnjudged,
} from '../judge-test-contribution.workflow.js'
import type { ReportView } from '../test-contribution.schema.js'

const lawsCommandArb = fc.record({
  report: fc.record({
    files: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 24 }),
      fc.record({
        mutants: fc.array(
          fc.record({
            status: fc.constantFrom('Killed', 'Timeout', 'Ignored'),
            killedBy: fc.array(fc.string({ minLength: 1, maxLength: 8 })),
            coveredBy: fc.array(fc.string({ minLength: 1, maxLength: 8 })),
          }),
        ),
      }),
    ),
    testFiles: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 24 }),
      fc.record({ tests: fc.array(fc.record({ id: fc.string({ minLength: 1, maxLength: 8 }) })) }),
    ),
  }),
  everyKillerRecorded: fc.boolean(),
  suffixes: fc.array(fc.string({ minLength: 1, maxLength: 24 })),
}))
type LawsCommand = fc.InferType<typeof lawsCommandArb>
const LawsCommand = Arbitrary.make(lawsCommandArb)

const JudgeVerdictTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-test-contribution/TestContributionVerdict',
)

const judgeLawsCommand = (command: LawsCommand) => ({
  report: {
    schemaVersion: '2',
    files: command.report.files,
    thresholds: { high: 80, low: 60, break: null as null },
    testFiles: command.report.testFiles,
  },
  suffixes: command.suffixes,
  everyKillerRecorded: command.everyKillerRecorded,
})

const decidedOf = (command: LawsCommand) =>
  judgeTestContribution(judgeLawsCommand(command) as JudgeTestContribution).pipe(Result.merge)

const contributionKeysOf = (report: ReportView): readonly string[] =>
  Object.keys(report.testFiles ?? {})

const verdictOfLaw = (command: LawsCommand): boolean => {
  const decision = decidedOf(command)
  const suffixes = command.suffixes.join(', ')
  return Match.value(decision).pipe(
    Match.tag('RunUnjudged', (verdict) => verdict.message.includes(suffixes)),
    Match.tag('BailHidesKillers', (verdict) => verdict.message.includes('disableBail: true')),
    Match.tag('NoKillCredited', (verdict) => verdict.message.includes('credited no kill')),
    Match.tag('RunReviewed', (verdict) => verdict.message.includes(suffixes)),
    Match.tag(
      'JointlyDeletable',
      (verdict) =>
        verdict.message.includes('Deleting these') &&
        decision.toothless.every((fileName) => verdict.message.includes(fileName)),
    ),
    Match.tag('NotJointlyDeletable', (verdict) =>
      verdict.message.includes('would not leave every mutant just as dead')),
    Match.exhaustive,
  )
}

const ruleOrderOfLaw = (command: LawsCommand): boolean => {
  const decision = decidedOf(command)
  const inScopeCount = decision.contribution.filter(([fileName]) =>
    command.suffixes.some((suffix) => fileName.endsWith(suffix))).length
  const everyKillerRecorded = command.everyKillerRecorded
  const credited = decision.contribution.some(([, entry]) => entry.totalKills > 0)
  const toothlessCount = decision.toothless.length
  const jointlySubsumed = toothlessCount > 0 &&
    decision.contribution
      .filter(([fileName]) => decision.toothless.includes(fileName))
      .every(([, entry]) => entry.totalKills > 0 || entry.killableCovered > 0)
  return Match.value(decision).pipe(
    Match.tag('RunUnjudged', () => true),
    Match.tag('BailHidesKillers', () => inScopeCount > 0),
    Match.tag('NoKillCredited', () => inScopeCount > 0 && everyKillerRecorded),
    Match.tag('RunReviewed', () => inScopeCount > 0 && everyKillerRecorded && credited),
    Match.tag('JointlyDeletable', () => toothlessCount > 0 && jointlySubsumed),
    Match.tag('NotJointlyDeletable', () => toothlessCount > 0),
    Match.exhaustive,
  )
}

describe('judgeTestContribution', () => {
  it.prop(
    '∀d_Verdict_∈Decision',
    [[RunUnjudged, BailHidesKillers, NoKillCredited, RunReviewed, JointlyDeletable, NotJointlyDeletable]],
    ([decision]) => Object.getOwnPropertySymbols(decision).includes(JudgeVerdictTypeId),
  )
  it.prop('∀c_Command_≡NeverThrows', [LawsCommand], ([command]) => {
    const decision = decidedOf(command)
    return typeof decision.failed === 'boolean' && typeof decision.message === 'string'
  })
  it.prop('∀c_Command_≡ContributionKeys', [LawsCommand], ([command]) => {
    const decision = decidedOf(command)
    const keys = contributionKeysOf(command.report)
    return decision.contribution.length === keys.length &&
      decision.contribution.every(([fileName]) => keys.includes(fileName))
  })
  it.prop('∀c_Command_≡ToothlessInScope', [LawsCommand], ([command]) => {
    const decision = decidedOf(command)
    const keys = contributionKeysOf(command.report)
    return decision.toothless.every(
      (fileName) =>
        keys.includes(fileName) && command.suffixes.some((suffix) => fileName.endsWith(suffix)),
    )
  })
  it.prop('∀c_Command_≡ContributionOrder', [LawsCommand], ([command]) => {
    const decision = decidedOf(command)
    return decision.contribution.every(
      ([, entry]) =>
        entry.soleKills <= entry.totalKills &&
        (!entry.coversUnattributedKill || entry.killableCovered > 0),
    )
  })
  it.prop('∀c_Command_≡Verdict', [LawsCommand], ([command]) => verdictOfLaw(command))
  it.prop('∀c_Command_≡RuleOrder', [LawsCommand], ([command]) => ruleOrderOfLaw(command))
})
