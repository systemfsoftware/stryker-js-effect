import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { MutationTestResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitIncrementalReport,
  AdmitIncrementalReportCommand,
  type IncrementalReportDecision,
} from './admit-incremental-report.workflow.js'
import { IncrementalReportSchema } from './IncrementalReport.schema.js'
import { strykerVersion } from './stryker-package.js'

const parseAndDecodeIncrementalReport = S.decodeUnknownResult(S.fromJsonString(IncrementalReportSchema))

export interface IncrementalReportCellInput {
  readonly incremental: boolean
  readonly incrementalFile: string
}

interface IncrementalReportRaw {
  readonly incremental: boolean
  readonly incrementalFile: string
  readonly contents: string | undefined
}

const readIncrementalReportRaw = (input: IncrementalReportCellInput) => {
  if (!input.incremental) {
    return Effect.succeed({ incremental: false, incrementalFile: input.incrementalFile, contents: undefined })
  }
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const contents = yield* fs.readFileString(input.incrementalFile).pipe(
      Effect.tapError((error) =>
        Match.value(error.reason).pipe(
          Match.tag('NotFound', () =>
            Effect.logInfo(
              `No incremental result file found at ${input.incrementalFile}, a full mutation testing run will be performed.`,
            )),
          Match.orElse(() => Effect.void),
        )
      ),
      Effect.catchTag('PlatformError', (error) =>
        Match.value(error.reason).pipe(
          Match.tag('NotFound', () => Effect.undefined),
          Match.orElse(() => Effect.fail(error)),
        )),
    )
    return { incremental: true, incrementalFile: input.incrementalFile, contents }
  })
}

const decodeIncrementalReportRaw = (raw: IncrementalReportRaw) =>
  Result.succeed(
    AdmitIncrementalReportCommand.make({
      report: Option.getOrUndefined(
        Option.flatMap(
          Option.fromUndefinedOr(raw.contents),
          (text) => Result.getSuccess(parseAndDecodeIncrementalReport(text)),
        ),
      ),
      expectedVersion: strykerVersion,
    }),
  )

const writeIncrementalReportOutcome = (
  outcome: Result.Result<IncrementalReportDecision, never>,
  raw: IncrementalReportRaw,
) =>
  Result.match(outcome, {
    onFailure: (error: never) => Effect.fail(error),
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('IncrementalReportKeep', (keep) => {
          const report: MutationTestResult = keep.report
          return Effect.succeedSome(report)
        }),
        Match.tag('IncrementalReportDiscard', (discard) => {
          if (!raw.incremental) {
            return Effect.succeedNone
          }
          return Option.match(Option.fromUndefinedOr(raw.contents), {
            onNone: () => Effect.succeedNone,
            onSome: () =>
              Option.match(Option.fromUndefinedOr(discard.actual), {
                onNone: () =>
                  Effect.logInfo(
                    `Unable to parse incremental result file at ${raw.incrementalFile}; a full mutation testing run will be performed.`,
                  ).pipe(Effect.as(Option.none())),
                onSome: (actual) =>
                  Effect.logInfo(
                    `Incremental result file at ${raw.incrementalFile} version ${actual} does not match expected version ${discard.expected}; a full mutation testing run will be performed.`,
                  ).pipe(Effect.as(Option.none())),
              }),
          })
        }),
        Match.exhaustive,
      ),
  })

export const incrementalReportCell = Sandwich.read(readIncrementalReportRaw)
  .decode(Sandwich.pure(decodeIncrementalReportRaw))
  .decide(admitIncrementalReport)
  .encode(Sandwich.pure((outcome: Result.Result<IncrementalReportDecision, never>) => Result.succeed(outcome)))
  .write(writeIncrementalReportOutcome) satisfies Cell.Cell<IncrementalReportCellInput, unknown, unknown, unknown>
