import { BenchSide } from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Result from 'effect/Result'
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

const PATH = 'p'
const RUN_SUCCEEDED = { _tag: 'RunSucceeded' } as const

const decodes = <T, E>(schema: S.Codec<T, E>, encoded: E): boolean => Result.isSuccess(S.decodeResult(schema)(encoded))

const pathFieldVerdicts = (value: string): ReadonlyArray<boolean> => [
  decodes(RunPathMoveIn, { _tag: 'RunPathMoveIn', side: 'A', tree: value, runPath: PATH, cwd: PATH, cli: PATH }),
  decodes(RunPathMoveIn, { _tag: 'RunPathMoveIn', side: 'A', tree: PATH, runPath: value, cwd: PATH, cli: PATH }),
  decodes(RunPathMoveIn, { _tag: 'RunPathMoveIn', side: 'A', tree: PATH, runPath: PATH, cwd: value, cli: PATH }),
  decodes(RunPathMoveIn, { _tag: 'RunPathMoveIn', side: 'A', tree: PATH, runPath: PATH, cwd: PATH, cli: value }),
  decodes(RunPathOccupied, { _tag: 'RunPathOccupied', side: 'A', runPath: value }),
  decodes(RunPathOutsideTree, { _tag: 'RunPathOutsideTree', side: 'A', tree: value, path: PATH }),
  decodes(RunPathOutsideTree, { _tag: 'RunPathOutsideTree', side: 'A', tree: PATH, path: value }),
  decodes(RunPathRestored, { _tag: 'RunPathRestored', side: 'A', tree: value }),
  decodes(RunPathUnrestored, { _tag: 'RunPathUnrestored', side: 'A', tree: value, runPath: PATH, run: RUN_SUCCEEDED }),
  decodes(RunPathUnrestored, { _tag: 'RunPathUnrestored', side: 'A', tree: PATH, runPath: value, run: RUN_SUCCEEDED }),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const boundaryValues = ['', ' ', PATH]
  const isPath = (value: string): boolean => value.length > 0

  it.prop(
    '∀s_RunPathFieldRefusal_≡EveryPathFieldRefusesOnlyTheEmptyString',
    { of: [S.String], subject: pathFieldVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(boundaryValues, drawn),
        (value) => Arr.every(subject(value), (accepted) => accepted === isPath(value)),
      ),
  )
}
