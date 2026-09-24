import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type MockRequestKind, MockRequestKindSchema } from './mock-registry.schema.js'

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

export const MockTargetDecisionSchema = S.Union([
  MockTargetSynthetic,
  MockTargetRedirected,
  MockTargetAutomocked,
])

export class MockTargetCommand extends S.TaggedClass<MockTargetCommand>()('MockTargetCommand', {
  salt: S.String,
  specifier: S.String,
  resolvedUrl: S.optional(S.String),
  kind: MockRequestKindSchema,
  isBuiltin: S.Boolean,
  redirectPath: S.optional(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const AUTOMOCK_KIND: Record<MockRequestKind, 'automock' | 'autospy'> = {
  manual: 'automock',
  automock: 'automock',
  autospy: 'autospy',
}

const automockKindOf = (kind: MockRequestKind): 'automock' | 'autospy' => AUTOMOCK_KIND[kind]

const automockDecisionOf = (command: MockTargetCommand): MockTargetDecision =>
  MockTargetAutomocked.make({ kind: automockKindOf(command.kind) })

const redirectDecisionOf = (redirectPath: string): MockTargetDecision => MockTargetRedirected.make({ redirectPath })

const decideWithoutFactory = (command: MockTargetCommand): MockTargetDecision =>
  Option.fromNullishOr(command.redirectPath).pipe(
    Option.map(redirectDecisionOf),
    Option.getOrElse(() => automockDecisionOf(command)),
  )

const decideTarget = (command: MockTargetCommand): MockTargetDecision =>
  Match.value(command.kind).pipe(
    Match.when('manual', (): MockTargetDecision => MockTargetSynthetic.make({ raw: command.specifier })),
    Match.when('automock', (): MockTargetDecision => decideWithoutFactory(command)),
    Match.when('autospy', (): MockTargetDecision => decideWithoutFactory(command)),
    Match.exhaustive,
  )

const decide = (command: MockTargetCommand): Result.Result<MockTargetDecision, never> =>
  Result.succeed(decideTarget(command))

export const resolveMockTarget = Workflow.make({
  command: MockTargetCommand,
  decision: MockTargetDecisionSchema,
  error: S.Never,
  decide,
})
