import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  JudgeTestContribution,
  judgeTestContribution,
  RunUnjudged,
  type TestContributionDecision,
} from '../judge-test-contribution.workflow.js'

const decisionOf = (result: Result.Result<TestContributionDecision, never>): TestContributionDecision =>
  result.pipe(Result.merge)

const testFileKeysOf = (command: JudgeTestContribution): readonly string[] =>
  Object.keys(command.report.testFiles ?? {})

const inScopeOf = (command: JudgeTestContribution): readonly string[] =>
  testFileKeysOf(command).filter((fileName) => command.suffixes.some((suffix) => fileName.endsWith(suffix)))

const REFUSALS: Record<TestContributionDecision['_tag'], boolean> = {
  RunUnjudged: false,
  BailHidesKillers: true,
  NoKillCredited: true,
  RunReviewed: false,
  JointlyDeletable: true,
  NotJointlyDeletable: true,
}

const DELETIONS: Record<TestContributionDecision['_tag'], boolean> = {
  RunUnjudged: false,
  BailHidesKillers: false,
  NoKillCredited: false,
  RunReviewed: false,
  JointlyDeletable: true,
  NotJointlyDeletable: true,
}

describe('judgeTestContribution', () => {
  it.prop(
    '∀c_Message_≡EveryDecisionCarriesText',
    { of: [JudgeTestContribution], subject: judgeTestContribution },
    (subject, [command]) => {
      const decision = decisionOf(subject(command))
      return typeof decision.failed === 'boolean' && decision.message.length > 0
    },
  )

  it.prop(
    '∀c_Contribution_≡KeysAreExactlyTheReportsTestFiles',
    { of: [JudgeTestContribution], subject: judgeTestContribution },
    (subject, [command]) => {
      const keys = testFileKeysOf(command)
      const contribution = decisionOf(subject(command)).contribution
      return contribution.length === keys.length && contribution.every(([fileName]) => keys.includes(fileName))
    },
  )

  it.prop(
    '∀c_Counts_≡SoleKillsAreTotalKillsAndUnattributedCoverIsKillableCovered',
    { of: [JudgeTestContribution], subject: judgeTestContribution },
    (subject, [command]) =>
      decisionOf(subject(command)).contribution.every(
        ([, entry]) =>
          entry.soleKills <= entry.totalKills && (!entry.coversUnattributedKill || entry.killableCovered > 0),
      ),
  )

  it.prop(
    '∀c_Scope_≡ToothlessFilesAreInScopeTestFiles',
    { of: [JudgeTestContribution], subject: judgeTestContribution },
    (subject, [command]) => {
      const inScope = inScopeOf(command)
      return decisionOf(subject(command)).toothless.every((fileName) => inScope.includes(fileName))
    },
  )

  it.prop(
    '∀c_Flag_≡FailedExactlyWhenTheVerdictRefusesTheRun',
    { of: [JudgeTestContribution], subject: judgeTestContribution },
    (subject, [command]) => {
      const decision = decisionOf(subject(command))
      return decision.failed === REFUSALS[decision._tag]
    },
  )

  it.prop(
    '∀c_Precedence_≡NoFileInScopeIsUnjudged',
    { of: [JudgeTestContribution], subject: judgeTestContribution },
    (subject, [command]) => inScopeOf(command).length > 0 || subject(command).pipe(decisionOf, S.is(RunUnjudged)),
  )

  it.prop(
    '∀c_Deletion_≡DeletionVerdictsCarryToothlessFiles',
    { of: [JudgeTestContribution], subject: judgeTestContribution },
    (subject, [command]) => {
      const decision = decisionOf(subject(command))
      return !DELETIONS[decision._tag] || decision.toothless.length > 0
    },
  )
})
