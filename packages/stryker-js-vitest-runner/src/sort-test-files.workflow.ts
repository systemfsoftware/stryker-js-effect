import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const FileOrderTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-vitest-runner/FileOrder')
type FileOrderTypeId = typeof FileOrderTypeId

export class TestFileOrder extends S.TaggedClass<TestFileOrder>()('TestFileOrder', {
  moduleId: S.String,
}) {
  readonly [FileOrderTypeId] = FileOrderTypeId
}

export class SortTestFiles extends S.TaggedClass<SortTestFiles>()('SortTestFiles', {
  order: S.Array(S.String),
  files: S.Array(S.String),
  priority: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const orderIndexOf = (order: readonly string[], file: string): number =>
  Option.getOrElse(Arr.findFirstIndex(order, (candidate) => candidate === file), () => Number.MAX_SAFE_INTEGER)

const priorityIndexOf = (priority: readonly string[], file: string): number =>
  Option.getOrElse(Arr.findFirstIndex(priority, (candidate) => candidate === file), () => Number.MAX_SAFE_INTEGER)

const compareFiles = (command: SortTestFiles) => (left: string, right: string): number =>
  Option.getOrElse(
    Arr.findFirst(
      [
        priorityIndexOf(command.priority, left) - priorityIndexOf(command.priority, right),
        orderIndexOf(command.order, left) - orderIndexOf(command.order, right),
      ],
      (rank) => rank !== 0,
    ),
    () => 0,
  )

const orderedOf = (command: SortTestFiles): readonly TestFileOrder[] =>
  [...command.files].sort(compareFiles(command)).map((moduleId) => TestFileOrder.make({ moduleId }))

const decide = (command: SortTestFiles): Result.Result<readonly TestFileOrder[], never> =>
  Result.succeed(orderedOf(command))

export const sortTestFiles = Workflow.make({
  command: SortTestFiles,
  decision: S.Array(TestFileOrder),
  error: S.Never,
  decide,
})
