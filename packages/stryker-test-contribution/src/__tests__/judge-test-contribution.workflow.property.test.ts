import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import {
  JudgeTestContribution,
  judgeTestContribution,
  } from '../judge-test-contribution.workflow.js'

const decidedOf = (command: JudgeTestContribution) => judgeTestContribution(command).pipe(Result.merge)

const contributionKeysOf = (command: JudgeTestContribution): readonly string[] =>
  Object.keys(command.report.testFiles ?? {})

const verdictOfLaw = (command: JudgeTestContribution): boolean => {
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

const ruleOrderOfLaw = (command: JudgeTestContribution): boolean => {
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
  it.prop('∀c_Command_≡NeverThrows', [JudgeTestContribution], ([command]) => {
    const decision = decidedOf(command)
    return typeof decision.failed === 'boolean' && typeof decision.message === 'string'
  })
  it.prop('∀c_Command_≡ContributionKeys', [JudgeTestContribution], ([command]) => {
    const decision = decidedOf(command)
    const keys = contributionKeysOf(command)
    return decision.contribution.length === keys.length &&
      decision.contribution.every(([fileName]) => keys.includes(fileName))
  })
  it.prop('∀c_Command_≡ToothlessInScope', [JudgeTestContribution], ([command]) => {
    const decision = decidedOf(command)
    const keys = contributionKeysOf(command)
    return decision.toothless.every(
      (fileName) =>
        keys.includes(fileName) && command.suffixes.some((suffix) => fileName.endsWith(suffix)),
    )
  })
  it.prop('∀c_Command_≡ContributionOrder', [JudgeTestContribution], ([command]) => {
    const decision = decidedOf(command)
    return decision.contribution.every(
      ([, entry]) =>
        entry.soleKills <= entry.totalKills &&
        (!entry.coversUnattributedKill || entry.killableCovered > 0),
    )
  })
  it.prop('∀c_Command_≡Verdict', [JudgeTestContribution], ([command]) => verdictOfLaw(command))
  it.prop('∀c_Command_≡RuleOrder', [JudgeTestContribution], ([command]) => ruleOrderOfLaw(command))
})
