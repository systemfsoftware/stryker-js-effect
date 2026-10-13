import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const EmptyDirectoryRemovalTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/EmptyDirectoryRemoval')
type EmptyDirectoryRemovalTypeId = typeof EmptyDirectoryRemovalTypeId

export class ClassifyEmptyDirectoryRemovalCommand extends S.TaggedClass<ClassifyEmptyDirectoryRemovalCommand>()(
  'ClassifyEmptyDirectoryRemovalCommand',
  {
    code: S.UndefinedOr(S.String),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DirectoryKept extends S.TaggedClass<DirectoryKept>()('DirectoryKept', {}) {
  readonly [EmptyDirectoryRemovalTypeId] = EmptyDirectoryRemovalTypeId
}

export class DirectoryAbsent extends S.TaggedClass<DirectoryAbsent>()('DirectoryAbsent', {}) {
  readonly [EmptyDirectoryRemovalTypeId] = EmptyDirectoryRemovalTypeId
}

export class RemovalFailed extends S.TaggedClass<RemovalFailed>()('RemovalFailed', {
  code: S.UndefinedOr(S.String),
}) {
  readonly [EmptyDirectoryRemovalTypeId] = EmptyDirectoryRemovalTypeId
}

export const EmptyDirectoryRemoval = S.Union([DirectoryKept, DirectoryAbsent, RemovalFailed])
export type EmptyDirectoryRemoval = typeof EmptyDirectoryRemoval.Type

const DirectoryKeptCode = S.Literals(['ENOTEMPTY', 'EEXIST', 'ENOTDIR'])

const DirectoryMissingCode = S.Literal('ENOENT')

const removalOfOtherCode = (code: string | undefined): EmptyDirectoryRemoval =>
  Boolean.match(S.is(DirectoryMissingCode)(code), {
    onTrue: (): EmptyDirectoryRemoval => DirectoryAbsent.make({}),
    onFalse: (): EmptyDirectoryRemoval => RemovalFailed.make({ code }),
  })

const decide = (command: ClassifyEmptyDirectoryRemovalCommand): Result.Result<EmptyDirectoryRemoval, never> =>
  Result.succeed(
    Boolean.match(S.is(DirectoryKeptCode)(command.code), {
      onTrue: (): EmptyDirectoryRemoval => DirectoryKept.make({}),
      onFalse: () => removalOfOtherCode(command.code),
    }),
  )

export const classifyEmptyDirectoryRemoval = Workflow.make({
  command: ClassifyEmptyDirectoryRemovalCommand,
  decision: EmptyDirectoryRemoval,
  error: S.Never,
  decide,
})
