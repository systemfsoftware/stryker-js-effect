import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'

import { admitInstrumentFiles } from './admit-instrument-files.workflow.js'
import { collectMutants, fileOutcome, isParsedOutcome, type ParsedFile, skipsOf, transformInto } from './Format.js'
import type { FormatRegistry } from './Format.schema.js'
import {
  type FileSchema,
  type InstrumenterOptions,
  InstrumentError,
  InstrumentFilesCommand,
  InstrumentResult,
} from './Instrument.schema.js'
import { Mutant as ApiMutant } from './Mutant.schema.js'
import { print } from './Printer.js'
import { createMutantCollector } from './Transformer.service.js'

type FileDescription = typeof FileSchema.Type

export interface InstrumentFilesInput {
  readonly files: readonly FileDescription[]
  readonly options: InstrumenterOptions
  readonly registry: FormatRegistry
}

type InstrumentFilesRaw = typeof InstrumentFilesCommand.Encoded & {
  readonly version: 'instrument-files'
  readonly files: readonly FileDescription[]
  readonly registry: FormatRegistry
  readonly parsed: readonly ParsedFile[]
  readonly mutants: readonly ApiMutant[]
}

const printedFile = (raw: InstrumentFilesRaw, { file, ast }: ParsedFile): FileDescription => ({
  name: file.name,
  mutate: file.mutate,
  content: print(ast, raw.registry.entryForFormat),
})

const instrumentedResult = (raw: InstrumentFilesRaw): InstrumentResult =>
  InstrumentResult.make({
    files: raw.parsed.map((parsed) => printedFile(raw, parsed)),
    mutants: [...raw.mutants],
    skipped: [...raw.skipped],
  })

const skippedOnlyResult = (raw: InstrumentFilesRaw): InstrumentResult =>
  InstrumentResult.make({ files: [], mutants: [], skipped: [...raw.skipped] })

const readInstrumentFiles = (input: InstrumentFilesInput): Effect.Effect<InstrumentFilesRaw, InstrumentError> =>
  Effect.gen(function*() {
    const outcomes = yield* Effect.forEach(
      input.files,
      (file) => fileOutcome({ registry: input.registry, file }),
      { concurrency: 1 },
    )
    const parsed = outcomes.filter(isParsedOutcome).map((outcome) => outcome.parsed)
    const collector = createMutantCollector()
    yield* Effect.forEach(
      parsed,
      ({ file, ast }) => transformInto({ registry: input.registry, collector, file, ast, options: input.options }),
      { concurrency: 1 },
    )
    const mutants = yield* collectMutants(collector)
    const skipped = outcomes.flatMap(skipsOf)
    return {
      _tag: 'InstrumentFilesCommand',
      version: 'instrument-files',
      fileCount: input.files.length,
      claimedCount: parsed.length,
      skipped,
      files: input.files,
      registry: input.registry,
      parsed,
      mutants,
    }
  })

export const instrumentFilesCell: Cell.Cell<InstrumentFilesInput, InstrumentResult, InstrumentError, never> = Sandwich
  .named('stryker.instrument.files')(
    (input: InstrumentFilesInput) => readInstrumentFiles(input),
  )
  .decide(admitInstrumentFiles)
  .write({
    InstrumentFilesAdmitted: (_admitted, raw) => Effect.succeed(instrumentedResult(raw)),
    InstrumentFilesSkippedOnly: (_skipped, raw) => Effect.succeed(skippedOnlyResult(raw)),
    CommandRejected: ({ issue }) => Effect.fail(InstrumentError.make({ message: issue, cause: new Error(issue) })),
  })
