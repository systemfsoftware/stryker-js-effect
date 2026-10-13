import { BenchSide } from '@systemfsoftware/stryker-e2e-core'
import * as Cause from 'effect/Cause'
import * as S from 'effect/Schema'

const RunPathPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-bench/RunPathPlan')
type RunPathPlanTypeId = typeof RunPathPlanTypeId

export class RunPathMoveIn extends S.TaggedClass<RunPathMoveIn>()('RunPathMoveIn', {
  side: BenchSide,
  tree: S.NonEmptyString,
  runPath: S.NonEmptyString,
  cwd: S.NonEmptyString,
  cli: S.NonEmptyString,
}) {
  readonly [RunPathPlanTypeId] = RunPathPlanTypeId
}

export class RunPathOccupied extends S.TaggedClass<RunPathOccupied>()('RunPathOccupied', {
  side: BenchSide,
  runPath: S.NonEmptyString,
}) {
  readonly [RunPathPlanTypeId] = RunPathPlanTypeId
}

export const RunPathPlan = S.Union([RunPathMoveIn, RunPathOccupied])
export type RunPathPlan = typeof RunPathPlan.Type

export class RunPathOutsideTree extends S.TaggedError<RunPathOutsideTree>()('RunPathOutsideTree', {
  side: BenchSide,
  tree: S.NonEmptyString,
  path: S.NonEmptyString,
}) {
  override get message(): string {
    return `side ${this.side}: ${this.path} is not inside the side's tree ${this.tree}, so it cannot run from the run path`
  }
}

const RunPathRestoredTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-bench/RunPathRestored')
type RunPathRestoredTypeId = typeof RunPathRestoredTypeId

export class RunPathRestored extends S.TaggedClass<RunPathRestored>()('RunPathRestored', {
  side: BenchSide,
  tree: S.NonEmptyString,
}) {
  readonly [RunPathRestoredTypeId] = RunPathRestoredTypeId
}

export const RunPathMoveBack = S.TaggedUnion({
  MovedBack: {},
  MoveBackFailed: { cause: S.Unknown },
})
export type RunPathMoveBack = typeof RunPathMoveBack.Type

export const RunPathRunEnd = S.TaggedUnion({
  RunSucceeded: {},
  RunFailed: { cause: S.Unknown },
})
export type RunPathRunEnd = typeof RunPathRunEnd.Type

const causeText = <C>(cause: C): string => Cause.pretty(Cause.isCause(cause) ? cause : Cause.die(cause))

export class RunPathUnrestored extends S.TaggedError<RunPathUnrestored>()('RunPathUnrestored', {
  side: BenchSide,
  tree: S.NonEmptyString,
  runPath: S.NonEmptyString,
  cause: S.optional(S.Unknown),
  run: RunPathRunEnd,
}) {
  override get message(): string {
    const run = RunPathRunEnd.match(this.run, {
      RunSucceeded: () => 'the run itself succeeded',
      RunFailed: (failed) => `the run itself failed: ${causeText(failed.cause)}`,
    })
    return `side ${this.side}: ${this.runPath} could not be moved back to ${this.tree}: ${
      causeText(this.cause)
    }; ${run}`
  }
}
