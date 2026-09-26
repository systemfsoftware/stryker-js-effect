import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RequestAffectedFilesCommand } from './CheckerCommands.schema.js'

const RequestTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/RequestAffectedFiles')
type RequestTypeId = typeof RequestTypeId

export class AffectedFilesRequested extends S.TaggedClass<AffectedFilesRequested>()('AffectedFilesRequested', {
  fileNames: S.Array(S.String),
}) {
  readonly [RequestTypeId] = RequestTypeId
}

export class NoAffectedFileRequested extends S.TaggedClass<NoAffectedFileRequested>()('NoAffectedFileRequested', {}) {
  readonly [RequestTypeId] = RequestTypeId
}

export const RequestedFiles = S.Union([AffectedFilesRequested, NoAffectedFileRequested])
export type RequestedFiles = typeof RequestedFiles.Type

const requestedFileNames = (
  presentFileNames: ReadonlyArray<string>,
  affectedFileNames: HashSet.HashSet<string>,
): ReadonlyArray<string> => Arr.filter(presentFileNames, (fileName) => HashSet.has(affectedFileNames, fileName))

const decide = (command: RequestAffectedFilesCommand): Result.Result<RequestedFiles, never> => {
  const requested = requestedFileNames(command.presentFileNames, HashSet.fromIterable(command.affectedFileNames))
  return Result.succeed(
    Boolean.match(requested.length === 0, {
      onTrue: () => NoAffectedFileRequested.make({}),
      onFalse: () => AffectedFilesRequested.make({ fileNames: requested }),
    }),
  )
}

export const requestAffectedFiles = Workflow.make({
  command: RequestAffectedFilesCommand,
  decision: RequestedFiles,
  error: S.Never,
  decide,
})
