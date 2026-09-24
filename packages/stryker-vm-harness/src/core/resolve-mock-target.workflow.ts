import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { MockRequestKindSchema } from './mock-registry.schema.js'

const MockTargetTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-vm-harness/MockTargetDecision')
type MockTargetTypeId = typeof MockTargetTypeId

export class MockTargetSynthetic extends S.TaggedClass<MockTargetSynthetic>()('MockTargetSynthetic', {
  raw: S.String,
}) {
  readonly [MockTargetTypeId] = MockTargetTypeId
}

export class MockTargetRedirected extends S.TaggedClass<MockTargetRedirected>()('MockTargetRedirected', {
  redirectPath: S.String,
}) {
  readonly [MockTargetTypeId] = MockTargetTypeId
}

export class MockTargetAutomocked extends S.TaggedClass<MockTargetAutomocked>()('MockTargetAutomocked', {
  kind: S.Literals(['automock', 'autospy']),
}) {
  readonly [MockTargetTypeId] = MockTargetTypeId
}

export type MockTargetDecision = MockTargetSynthetic | MockTargetRedirected | MockTargetAutomocked

export class MockTargetCommand extends S.TaggedClass<MockTargetCommand>()('MockTargetCommand', {
  salt: S.String,
  specifier: S.String,
  resolvedUrl: S.optional(S.String),
  kind: MockRequestKindSchema,
  isBuiltin: S.Boolean,
  redirectPath: S.optional(S.String),
}) {}

const decideWithoutFactory = (command: MockTargetCommand): MockTargetDecision => {
  const redirectPath = command.redirectPath
  if (redirectPath === undefined) {
    return MockTargetAutomocked.make({ kind: command.kind === 'manual' ? 'automock' : command.kind })
  }
  return MockTargetRedirected.make({ redirectPath })
}

const decideTarget = (command: MockTargetCommand): MockTargetDecision =>
  Match.value(command.kind).pipe(
    Match.when('manual', (): MockTargetDecision => MockTargetSynthetic.make({ raw: command.specifier })),
    Match.when('automock', (): MockTargetDecision => decideWithoutFactory(command)),
    Match.when('autospy', (): MockTargetDecision => decideWithoutFactory(command)),
    Match.exhaustive,
  )

export const resolveMockTarget = Workflow.total(
  MockTargetCommand,
  (command: MockTargetCommand) => Result.succeed(decideTarget(command)),
)
