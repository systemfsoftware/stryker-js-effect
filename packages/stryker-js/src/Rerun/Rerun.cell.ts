import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { type OutputMode, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { relativeNormalizedFileName } from '../FileMatcher.js'
import { readConfig } from '../run/load-config.js'
import type { MutationTestDone } from '../run/mutation-test.cell.js'
import type { EnginePorts } from '../run/StageServices.service.js'
import { PriorReportDocument } from '../Survivors/Survivors.schema.js'
import { admitMutantRerun, type PriorMutantShape, RerunRefused } from './admit-mutant-rerun.workflow.js'

export type MutantRerunSettled = void | MutationTestDone

export interface MutantRerunRun {
  readonly ids: ReadonlyArray<string>
  readonly mutateSpans: ReadonlyArray<string>
  readonly resolvedOptions: Options.StrykerOptions
}

export interface MutantRerunSettlement {
  readonly runAdmitted: (run: MutantRerunRun) => Effect.Effect<MutantRerunSettled, never, EnginePorts>
}

export interface MutantRerunInput {
  readonly ids: ReadonlyArray<string>
  readonly cliOptions: Options.PartialStrykerOptions
  readonly mode: OutputMode.OutputMode
  readonly basePath: string
  readonly settle: MutantRerunSettlement
}

const DEFAULT_PRIOR_REPORT = 'reports/mutation/mutation.json'

const resolveRerunOptions = Effect.fnUntraced(function*(input: {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly mode: OutputMode.OutputMode
}) {
  return yield* readConfig(input.cliOptions, { command: 'run', mode: input.mode })
})

const priorReportText = Effect.fnUntraced(function*(priorReportPath: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(priorReportPath).pipe(
    Effect.option,
    Effect.map(Option.getOrElse(() => '')),
  )
})

const priorMutantsOf = (text: string, basePath: string): ReadonlyArray<typeof PriorMutantShape.Type> =>
  Option.match(S.decodeOption(S.fromJsonString(PriorReportDocument))(text), {
    onNone: (): ReadonlyArray<typeof PriorMutantShape.Type> => [],
    onSome: (document) =>
      Object.entries(document.files).flatMap(([file, fileResult]) => {
        const fileName = `${basePath}/${file}`
        const relativeFileName = relativeNormalizedFileName(fileName, basePath)
        return fileResult.mutants.map((mutant): typeof PriorMutantShape.Type => ({
          _tag: 'Mutant',
          id: mutant.id,
          fileName: Mutant.CanonicalFileName.make(fileName),
          mutatorName: Mutant.MutatorName.make(mutant.mutatorName),
          replacement: mutant.replacement ?? mutant.mutatorName,
          location: mutant.location,
          relativeFileName,
        }))
      }),
  })

const readMutantRerun = Effect.fnUntraced(function*(input: MutantRerunInput) {
  const resolvedOptions = yield* resolveRerunOptions({ cliOptions: input.cliOptions, mode: input.mode })
  const priorReportPath = DEFAULT_PRIOR_REPORT
  const text = yield* priorReportText(priorReportPath)
  return {
    ids: [...input.ids],
    priorMutants: priorMutantsOf(text, input.basePath),
    priorReportPath,
    resolvedOptions,
    settle: input.settle,
  }
})

export const mutantRerunAdmissionCell = Sandwich.named(SpanTaxonomy.Spans.rerun.name)(readMutantRerun)
  .decide(admitMutantRerun)
  .write({
    RerunAdmitted: (admitted, raw) =>
      raw.settle.runAdmitted({
        ids: admitted.ids,
        mutateSpans: admitted.mutateSpans,
        resolvedOptions: raw.resolvedOptions,
      }),
    RerunRefused: (refused) => Effect.flatMap(S.decodeEffect(RerunRefused)(refused), (decoded) => Effect.fail(decoded)),
    CommandRejected: ({ issue }) => Effect.fail(RerunRefused.make({ unknownIds: [], reason: issue })),
  })
