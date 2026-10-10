import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { MutationTestCommand } from './MutationTest.schema.js'

export class MutationTestError extends S.TaggedError<MutationTestError>()('MutationTestError', {
  stage: S.Literal('mutationTest'),
  reason: S.String,
}) {
  override get message(): string {
    return this.reason
  }
}

const MutationTestDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutationTestDecision')
type MutationTestDecisionTypeId = typeof MutationTestDecisionTypeId

export class MutationTestProceed extends S.TaggedClass<MutationTestProceed>()('MutationTestProceed', {}) {
  readonly [MutationTestDecisionTypeId] = MutationTestDecisionTypeId
}

export class MutationTestDryRunOnly extends S.TaggedClass<MutationTestDryRunOnly>()('MutationTestDryRunOnly', {}) {
  readonly [MutationTestDecisionTypeId] = MutationTestDecisionTypeId
}

export class MutationTestNoTests extends S.TaggedClass<MutationTestNoTests>()('MutationTestNoTests', {}) {
  readonly [MutationTestDecisionTypeId] = MutationTestDecisionTypeId
}

export type MutationTestDecision = MutationTestProceed | MutationTestDryRunOnly | MutationTestNoTests

const decide = (command: MutationTestCommand): Result.Result<MutationTestDecision, MutationTestError> =>
  Match.value({
    invalid: command.testCount < 0,
    dryRunOnly: command.dryRunOnly,
    isZero: command.isZero,
    allowEmpty: command.allowEmpty,
  }).pipe(
    Match.when({ invalid: true }, () =>
      Result.fail(MutationTestError.make({ stage: 'mutationTest', reason: 'Invalid test count' }))),
    Match.when({ dryRunOnly: true }, () =>
      Result.succeed(MutationTestDryRunOnly.make({}))),
    Match.when({ isZero: true, allowEmpty: true }, () => Result.succeed(MutationTestNoTests.make({}))),
    Match.orElse(() => Result.succeed(MutationTestProceed.make({}))),
  )

export const admitMutationTest = Workflow.make({
  command: MutationTestCommand,
  decision: S.Union([MutationTestProceed, MutationTestDryRunOnly, MutationTestNoTests]),
  error: MutationTestError,
  decide,
})
