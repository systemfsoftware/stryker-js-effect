import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Reports } from '@systemfsoftware/stryker-js-contracts'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FEEDBACK_FILE, readSurfacedSurvivors } from './read-report.js'
import { recordFeedback, RecordFeedbackCommand } from './record-feedback.workflow.js'

const appendLine = (basePath: string, line: string): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.resolve(basePath, FEEDBACK_FILE)
    yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.orDie)
    yield* fs.writeFileString(file, `${line}\n`, { flag: 'a' }).pipe(Effect.orDie)
  })

const encodeLine = (line: RunEvent.FeedbackReported): Effect.Effect<string, never, never> =>
  Effect.orDie(S.encodeEffect(S.fromJsonString(RunEvent.FeedbackReported))(line))

export interface RecordFeedbackRequest {
  readonly basePath: string
  readonly id: string
  readonly judgment: RunEvent.FeedbackJudgment
  readonly reason: string | null
}

const mutantIdOf = (id: string): Effect.Effect<Mutant.MutantId, Reports.FeedbackUnusable> =>
  Effect.fromResult(
    Result.mapError(
      S.decodeResult(Mutant.MutantId)(id),
      () => Reports.FeedbackUnusable.make({ reason: `${id} is not a 16-character lowercase hexadecimal mutant id` }),
    ),
  )

export const recordFeedbackCell = (
  request: RecordFeedbackRequest,
): Effect.Effect<RunEvent.FeedbackReported, Reports.FeedbackUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const id = yield* mutantIdOf(request.id)
    const survivors = yield* readSurfacedSurvivors(request.basePath)
    const decision = Result.getOrThrow(
      recordFeedback(
        RecordFeedbackCommand.make({
          id,
          judgment: request.judgment,
          reason: request.reason,
          knownIds: survivors.map((survivor) => survivor.id),
        }),
      ),
    )
    return yield* Match.value(decision).pipe(
      Match.tag('FeedbackRecorded', (recorded) =>
        encodeLine(
          RunEvent.FeedbackReported.make({
            id: recorded.id,
            judgment: recorded.judgment,
            reason: recorded.reason,
          }),
        ).pipe(
          Effect.flatMap((line) => appendLine(request.basePath, line)),
          Effect.as(
            RunEvent.FeedbackReported.make({
              id: recorded.id,
              judgment: recorded.judgment,
              reason: recorded.reason,
            }),
          ),
        )),
      Match.tag('FeedbackRefused', () =>
        Effect.fail(
          Reports.FeedbackUnusable.make({
            reason:
              `no surfaced survivor ${request.id} in the mutation report; run \`stryker run\` first, or read the ids from list_survivors`,
          }),
        )),
      Match.exhaustive,
    )
  })
