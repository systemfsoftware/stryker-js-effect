import { BenchSide } from '@systemfsoftware/stryker-e2e-core'
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

export class RunPathUnrestored extends S.TaggedError<RunPathUnrestored>()('RunPathUnrestored', {
  side: BenchSide,
  tree: S.NonEmptyString,
  runPath: S.NonEmptyString,
  restoreError: S.String,
  runFailure: S.NullOr(S.String),
}) {
  override get message(): string {
    const run = this.runFailure === null ? 'the run itself succeeded' : `the run itself failed: ${this.runFailure}`
    return `side ${this.side}: ${this.runPath} could not be moved back to ${this.tree}: ${this.restoreError}; ${run}`
  }
}
