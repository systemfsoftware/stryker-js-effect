import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'

import { admitSurvivorsRun, Admitted, NoSurvivors, SurvivorsRejection } from '../admit-survivors-run.workflow.js'
import type { OutputMode } from '../output-mode.schema.js'
import {
  currentSourceHashesFor,
  priorReportFileKeys,
  priorReportPathOf,
  readPriorReport,
  resolveSurvivorsRunOptions,
  survivorsRawOf,
} from './Survivors.parts.js'

export interface SurvivorsAdmissionInput {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly mode: OutputMode
  readonly basePath: string
}

export interface SurvivorsAdmissionAnswer {
  readonly admission: Admitted | NoSurvivors
  readonly resolvedOptions: Options.StrykerOptions
  readonly priorReportPath: string
}

export const survivorsAdmissionCell = Sandwich.named('stryker.survivors_admission')((input: SurvivorsAdmissionInput) =>
  Effect.gen(function*() {
    const resolvedOptions = yield* resolveSurvivorsRunOptions({ cliOptions: input.cliOptions, mode: input.mode })
    const priorReportPath = priorReportPathOf(resolvedOptions)
    const read = yield* readPriorReport(priorReportPath)
    const sourceContentHashes = yield* currentSourceHashesFor(priorReportFileKeys(read.raw))
    return yield* survivorsRawOf({
      read,
      resolvedOptions,
      priorReportPath,
      basePath: input.basePath,
      sourceContentHashes,
    })
  })
).decide(admitSurvivorsRun).write({
  Admitted: (admitted, raw) =>
    Effect.map(
      S.decodeEffect(Admitted)(admitted),
      (admission) => ({
        admission,
        resolvedOptions: raw.resolvedOptions,
        priorReportPath: raw.priorReportPath,
      }),
    ),
  NoSurvivors: (_outcome, raw) =>
    Effect.succeed({
      admission: NoSurvivors.make(),
      resolvedOptions: raw.resolvedOptions,
      priorReportPath: raw.priorReportPath,
    }),
  SurvivorsRejection: (rejection) => Effect.fail(SurvivorsRejection.make(rejection)),
  CommandRejected: ({ issue }) => Effect.fail(SurvivorsRejection.make({ reason: 'mismatch', remediation: issue })),
})
