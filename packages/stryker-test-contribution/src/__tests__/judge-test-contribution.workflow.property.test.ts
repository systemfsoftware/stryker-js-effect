import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BailHidesKillers,
  JointlyDeletable,
  JudgeTestContribution,
  judgeTestContribution,
  NoKillCredited,
  NotJointlyDeletable,
  RunReviewed,
  RunUnjudged,
} from '../judge-test-contribution.workflow.js'

const JudgeVerdictTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-test-contribution/TestContributionVerdict',
)

const creditedAnyKill = (command: JudgeTestContribution): boolean =>
  command.contribution.some(([, entry]) => entry.totalKills > 0)
const jointlyCredited = (command: JudgeTestContribution): boolean =>
  command.everyKillerRecorded && creditedAnyKill(command)

const jointlySubsumed = (command: JudgeTestContribution): boolean =>
  command.kills.every(
    (kill) => kill.killers.length === 0 || kill.killers.some((fileName) => !command.toothless.includes(fileName)),
  )

describe('judgeTestContribution', () => {
  it.prop(
    '∀d_Verdict_∈Decision',
    [
      S.Union([RunUnjudged, BailHidesKillers, NoKillCredited, RunReviewed, JointlyDeletable, NotJointlyDeletable]),
    ],
    ([decision]) => Object.getOwnPropertySymbols(decision).includes(JudgeVerdictTypeId),
  )
  it.prop('∀c_Command_≡Verdict', [JudgeTestContribution], ([command]) => {
    const result = judgeTestContribution(command)
    return Result.isSuccess(result) && Match.value(result.success).pipe(
      Match.tag('RunUnjudged', (verdict) => verdict.message.includes(command.matches)),
      Match.tag('BailHidesKillers', (verdict) => verdict.message.includes('disableBail: true')),
      Match.tag('NoKillCredited', (verdict) => verdict.message.includes('credited no kill')),
      Match.tag('RunReviewed', (verdict) => verdict.message.includes(command.matches)),
      Match.tag(
        'JointlyDeletable',
        (verdict) =>
          verdict.message.includes('Deleting these') &&
          command.toothless.every((fileName) => verdict.message.includes(fileName)),
      ),
      Match.tag('NotJointlyDeletable', (verdict) =>
        verdict.message.includes('would not leave every mutant just as dead')),
      Match.exhaustive,
    )
  })
  it.prop('∀c_Command_≡RuleOrder', [JudgeTestContribution], ([command]) => {
    const result = judgeTestContribution(command)
    return Result.isSuccess(result) && Match.value(result.success).pipe(
      Match.tag('RunUnjudged', () => true),
      Match.tag('BailHidesKillers', () => command.inScope.length > 0),
      Match.tag('NoKillCredited', () => command.inScope.length > 0 && command.everyKillerRecorded),
      Match.tag('RunReviewed', () => command.inScope.length > 0 && jointlyCredited(command)),
      Match.tag('JointlyDeletable', () => command.toothless.length > 0 && jointlySubsumed(command)),
      Match.tag('NotJointlyDeletable', () => command.toothless.length > 0 && !jointlySubsumed(command)),
      Match.exhaustive,
    )
  })
})
