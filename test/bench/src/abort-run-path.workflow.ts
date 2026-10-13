import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  RunPathAbort,
  RunPathFailure,
  RunPathMoveFailedAbort,
  RunPathOccupiedAbort,
  RunPathUnrestoredAbort,
} from './run-path.schema.js'

export class AbortRunPathCommand extends S.TaggedClass<AbortRunPathCommand>()('AbortRunPathCommand', {
  failure: RunPathFailure,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decide = (command: AbortRunPathCommand): Result.Result<RunPathAbort, never> =>
  Result.succeed(
    Match.valueTags(command.failure, {
      RunPathOccupied: (occupied): RunPathAbort =>
        RunPathOccupiedAbort.make({
          code: 'run-path-occupied',
          reason: `side ${occupied.side}: ${occupied.runPath} already exists before the side's tree moved in`,
        }),
      RunPathUnlisted: (unlisted): RunPathAbort =>
        RunPathMoveFailedAbort.make({ code: 'run-path-move-failed', reason: unlisted.message }),
      RunPathOutsideTree: (outside): RunPathAbort =>
        RunPathMoveFailedAbort.make({ code: 'run-path-move-failed', reason: outside.message }),
      RunPathMoveInFailed: (failed): RunPathAbort =>
        RunPathMoveFailedAbort.make({ code: 'run-path-move-failed', reason: failed.message }),
      RunPathUnrestored: (unrestored): RunPathAbort =>
        RunPathUnrestoredAbort.make({ code: 'run-path-unrestored', reason: unrestored.message }),
    }),
  )

export const abortRunPath = Workflow.make({
  command: AbortRunPathCommand,
  decision: RunPathAbort,
  error: S.Never,
  decide,
})
