import * as S from 'effect/Schema'

import { BenchSide } from './bench-run.schema.js'

const RunPathPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/RunPathPlan')
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
