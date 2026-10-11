import * as S from 'effect/Schema'

import { BenchRunKey, BenchSide } from './bench-run.schema.js'

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

const RunPathRestoredTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/RunPathRestored')
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

export const RunRoot = S.Struct({ key: BenchRunKey, projectRoot: S.NonEmptyString })
export type RunRoot = typeof RunRoot.Type

const RunRootsAgreedTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/RunRootsAgreed')
type RunRootsAgreedTypeId = typeof RunRootsAgreedTypeId

export class RunRootsAgreed extends S.TaggedClass<RunRootsAgreed>()('RunRootsAgreed', {
  projectRoot: S.NullOr(S.NonEmptyString),
}) {
  readonly [RunRootsAgreedTypeId] = RunRootsAgreedTypeId
}

export class RunRootsDiffer extends S.TaggedError<RunRootsDiffer>()('RunRootsDiffer', {
  first: RunRoot,
  other: RunRoot,
}) {
  override get message(): string {
    return `run ${this.first.key.label} ran from ${this.first.projectRoot}, but run ${this.other.key.label} ran from ${this.other.projectRoot}`
  }
}

export class RunIdentityUnreadable extends S.TaggedError<RunIdentityUnreadable>()('RunIdentityUnreadable', {
  key: BenchRunKey,
  file: S.NonEmptyString,
  reason: S.NonEmptyString,
}) {
  override get message(): string {
    return `run ${this.key.label}: ${this.file} gave no run identity: ${this.reason}`
  }
}

export const RunRootsRefused = S.Union([RunIdentityUnreadable, RunRootsDiffer])
export type RunRootsRefused = typeof RunRootsRefused.Type

export const RunIdentitySource = S.Struct({
  projectRoot: S.NonEmptyString,
  runInputsDigest: S.NonEmptyString,
  files: S.Record(S.String, S.Struct({ mutants: S.Array(S.Struct({ id: S.NonEmptyString })) })),
})
export type RunIdentitySource = typeof RunIdentitySource.Type

const RunIdentityReadTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/RunIdentityRead')
type RunIdentityReadTypeId = typeof RunIdentityReadTypeId

export class RunIdentityRead extends S.TaggedClass<RunIdentityRead>()('RunIdentityRead', {
  projectRoot: S.NonEmptyString,
  runInputsDigest: S.NonEmptyString,
  mutantIds: S.Array(S.NonEmptyString),
}) {
  readonly [RunIdentityReadTypeId] = RunIdentityReadTypeId
}

export class RunIdentityUndecodable extends S.TaggedError<RunIdentityUndecodable>()('RunIdentityUndecodable', {
  file: S.NonEmptyString,
  reason: S.NonEmptyString,
}) {
  override get message(): string {
    return `${this.file} does not decode as an incremental report with projectRoot, runInputsDigest and mutant ids: ${this.reason}`
  }
}
