import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import type { Report } from '@systemfsoftware/stryker-js-plugin-interface'

import {
  type CommandSpec,
  CommandSpecSchema,
  type TestFileSpec,
} from '../../tests/__fixtures__/judge-test-contribution.schema.js'
import {
  JudgeTestContribution,
  judgeTestContribution,
  type TestContributionDecision,
} from '../judge-test-contribution.workflow.js'

const LOCATION = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }

const testFileNameOf = (file: TestFileSpec, index: number, suffixes: readonly string[]): string =>
  file.inScope && suffixes.length > 0
    ? `src/file${index}${suffixes[index % suffixes.length]}`
    : `src/file${index}.test.ts`

const commandOf = (spec: CommandSpec): JudgeTestContribution =>
  JudgeTestContribution.make({
    report: {
      schemaVersion: '2',
      files: {
        'src/subject.ts': {
          language: 'typescript',
          source: 'export const a = 1\n',
          mutants: spec.mutants.map((mutant, index): Report.MutantResult => ({
            id: `m${index}`,
            status: mutant.status,
            mutatorName: 'BooleanLiteral',
            location: LOCATION,
            killedBy: [...mutant.killedBy],
            coveredBy: [...mutant.coveredBy],
          })),
        },
      },
      thresholds: { high: 80, low: 60 },
      testFiles: Object.fromEntries(
        spec.testFiles.map((file, index) => [
          testFileNameOf(file, index, spec.suffixes),
          { tests: file.tests.map((id) => ({ id, name: `test ${id}` })) },
        ]),
      ),
    },
    everyKillerRecorded: spec.everyKillerRecorded,
    suffixes: [...spec.suffixes],
  })

const contributionKeysOf = (command: JudgeTestContribution): readonly string[] =>
  Object.keys(command.report.testFiles ?? {})

const decisionOf = (result: Result.Result<TestContributionDecision, never>): TestContributionDecision =>
  result.pipe(Result.merge)

const verdictOfLaw = (decision: TestContributionDecision, command: JudgeTestContribution): boolean => {
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
    Match.tag(
      'NotJointlyDeletable',
      (verdict) => verdict.message.includes('would not leave every mutant just as dead'),
    ),
    Match.exhaustive,
  )
}

const ruleOrderOfLaw = (decision: TestContributionDecision, command: JudgeTestContribution): boolean => {
  const inScopeCount =
    decision.contribution.filter(([fileName]) => command.suffixes.some((suffix) => fileName.endsWith(suffix))).length
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
    '∀c_Command_≡NeverThrows',
    { of: [CommandSpecSchema], subject: judgeTestContribution },
    (subject, [spec]) => {
      const decision = decisionOf(subject(commandOf(spec)))
      return typeof decision.failed === 'boolean' && typeof decision.message === 'string'
    },
  )
  it.prop(
    '∀c_Command_≡ContributionKeys',
    { of: [CommandSpecSchema], subject: judgeTestContribution },
    (subject, [spec]) => {
      const command = commandOf(spec)
      const decision = decisionOf(subject(command))
      const keys = contributionKeysOf(command)
      return decision.contribution.length === keys.length &&
        decision.contribution.every(([fileName]) => keys.includes(fileName))
    },
  )
  it.prop(
    '∀c_Command_≡ToothlessInScope',
    { of: [CommandSpecSchema], subject: judgeTestContribution },
    (subject, [spec]) => {
      const command = commandOf(spec)
      const decision = decisionOf(subject(command))
      const keys = contributionKeysOf(command)
      return decision.toothless.every(
        (fileName) => keys.includes(fileName) && command.suffixes.some((suffix) => fileName.endsWith(suffix)),
      )
    },
  )
  it.prop(
    '∀c_Command_≡ContributionOrder',
    { of: [CommandSpecSchema], subject: judgeTestContribution },
    (subject, [spec]) => {
      const decision = decisionOf(subject(commandOf(spec)))
      return decision.contribution.every(
        ([, entry]) =>
          entry.soleKills <= entry.totalKills &&
          (!entry.coversUnattributedKill || entry.killableCovered > 0),
      )
    },
  )
  it.prop(
    '∀c_Command_≡Verdict',
    { of: [CommandSpecSchema], subject: judgeTestContribution },
    (subject, [spec]) => {
      const command = commandOf(spec)
      return verdictOfLaw(decisionOf(subject(command)), command)
    },
  )
  it.prop(
    '∀c_Command_≡RuleOrder',
    { of: [CommandSpecSchema], subject: judgeTestContribution },
    (subject, [spec]) => {
      const command = commandOf(spec)
      return ruleOrderOfLaw(decisionOf(subject(command)), command)
    },
  )
})
