import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitInstrumentFiles,
  type InstrumentFilesDecision,
  InstrumentFilesSkippedOnly,
} from './admit-instrument-files.workflow.js'
import type { FormatRegistry } from './format-registry.js'
import { parseWithEntry, resolveFile } from './format-registry.js'
import {
  type FileSchema,
  type InstrumenterOptions,
  InstrumentError,
  InstrumentFilesCommand,
  InstrumentFileSkip,
  InstrumentResult,
} from './Instrument.schema.js'
import { Mutant as ApiMutant } from './Mutant.schema.js'
import { toApiMutant } from './Mutator.js'
import { print } from './Printer.js'
import { FormatAssigned, type FormatResolutionDecision, FormatSkipped } from './resolve-format.workflow.js'
import type { Ast } from './Syntax.js'
import { createMutantCollector, type MutantCollector, transform, type TransformerOptions } from './Transformer.js'

type FileDescription = typeof FileSchema.Type

export interface InstrumentFilesInput {
  readonly files: readonly FileDescription[]
  readonly options: InstrumenterOptions
  readonly registry: FormatRegistry
}

interface ParsedFile {
  readonly file: FileDescription
  readonly ast: Ast
}

interface InstrumentFilesRaw {
  readonly files: readonly FileDescription[]
  readonly registry: FormatRegistry
  readonly parsed: readonly ParsedFile[]
  readonly skipped: readonly InstrumentFileSkip[]
  readonly mutants: readonly ApiMutant[]
}

type FileOutcome =
  | { readonly kind: 'parsed'; readonly parsed: ParsedFile }
  | { readonly kind: 'skipped'; readonly record: InstrumentFileSkip }

const isIgnorer = (value: unknown): value is Ignorer =>
  Predicate.isObject(value) && typeof value['shouldIgnore'] === 'function'

const toTransformerOptions = (options: InstrumenterOptions): TransformerOptions => ({
  excludedMutations: [...options.excludedMutations],
  ignorers: options.ignorers.filter(isIgnorer),
  ...(options.noHeader !== undefined ? { noHeader: options.noHeader } : {}),
})

const toOneBasedLineNumber = (file: FileDescription): FileDescription['mutate'] =>
  typeof file.mutate === 'boolean'
    ? file.mutate
    : file.mutate.map(({ start, end }) => ({
      start: { column: start.column, line: start.line + 1 },
      end: { column: end.column, line: end.line + 1 },
    }))

const parsedOutcome = (
  registry: FormatRegistry,
  file: FileDescription,
  assigned: FormatAssigned,
): Effect.Effect<FileOutcome, InstrumentError> =>
  Option.match(registry.entryForFormat(assigned.formatId), {
    onNone: () =>
      Effect.fail(
        InstrumentError.make({
          message: `No registered format entry renders "${assigned.formatId}", claimed for ${file.name}`,
          cause: new Error(`Missing format entry for "${assigned.formatId}"`),
        }),
      ),
    onSome: (entry) =>
      Effect.map(parseWithEntry(entry, file), (ast): FileOutcome => ({ kind: 'parsed', parsed: { file, ast } })),
  })

const skippedOutcome = (file: FileDescription, skipped: FormatSkipped): FileOutcome => ({
  kind: 'skipped',
  record: InstrumentFileSkip.make({ file: file.name, extension: skipped.extension, reason: skipped.reason }),
})

const unclaimedOverride = (file: FileDescription): InstrumentError =>
  InstrumentError.make({
    message: `No installed format owns ${file.name}`,
    cause: new Error(`Unresolvable format pin for ${file.name}`),
  })

const outcomeFor = (
  registry: FormatRegistry,
  file: FileDescription,
  decision: FormatResolutionDecision,
): Effect.Effect<FileOutcome, InstrumentError> =>
  Match.value(decision).pipe(
    Match.when(S.is(FormatAssigned), (assigned) => parsedOutcome(registry, file, assigned)),
    Match.when(S.is(FormatSkipped), (skipped) => Effect.succeed(skippedOutcome(file, skipped))),
    Match.exhaustive,
  )

const fileOutcome = (registry: FormatRegistry, file: FileDescription): Effect.Effect<FileOutcome, InstrumentError> =>
  Match.value(resolveFile(registry, file.name)).pipe(
    Match.when(Result.isSuccess, (resolved) => outcomeFor(registry, file, resolved.success)),
    Match.orElse(() => Effect.fail(unclaimedOverride(file))),
  )

const transformInto = (
  registry: FormatRegistry,
  collector: MutantCollector,
  file: FileDescription,
  ast: Ast,
  options: InstrumenterOptions,
): Effect.Effect<void, InstrumentError> =>
  transform(ast, collector, {
    options: toTransformerOptions(options),
    mutateDescription: toOneBasedLineNumber(file),
    registry,
  }).pipe(
    Effect.mapError((cause) => InstrumentError.make({ message: `Failed to transform ${file.name}`, cause })),
  )

const collectMutants = (collector: MutantCollector): Effect.Effect<readonly ApiMutant[], InstrumentError> =>
  Effect.try({
    try: () => collector.map(toApiMutant),
    catch: (cause) => InstrumentError.make({ message: 'Failed to instrument', cause }),
  })

const isParsed = (outcome: FileOutcome): outcome is Extract<FileOutcome, { kind: 'parsed' }> =>
  outcome.kind === 'parsed'

const skipsOf = (outcome: FileOutcome): readonly InstrumentFileSkip[] =>
  outcome.kind === 'skipped' ? [outcome.record] : []

const readInstrumentFiles = (input: InstrumentFilesInput): Effect.Effect<InstrumentFilesRaw, InstrumentError> =>
  Effect.gen(function*() {
    const outcomes = yield* Effect.forEach(input.files, (file) => fileOutcome(input.registry, file), { concurrency: 1 })
    const parsed = outcomes.filter(isParsed).map((outcome) => outcome.parsed)
    const collector = createMutantCollector()
    yield* Effect.forEach(
      parsed,
      ({ file, ast }) => transformInto(input.registry, collector, file, ast, input.options),
      { concurrency: 1 },
    )
    const mutants = yield* collectMutants(collector)
    return {
      files: input.files,
      registry: input.registry,
      parsed,
      skipped: outcomes.flatMap(skipsOf),
      mutants,
    }
  })

const decodeInstrumentFiles = (raw: InstrumentFilesRaw): Result.Result<InstrumentFilesCommand, never> =>
  Result.succeed(
    InstrumentFilesCommand.make({
      fileCount: raw.files.length,
      claimedCount: raw.parsed.length,
      skipped: [...raw.skipped],
    }),
  )

const printedFile = (raw: InstrumentFilesRaw, { file, ast }: ParsedFile): FileDescription => ({
  name: file.name,
  mutate: file.mutate,
  content: print(ast, raw.registry.entryForFormat),
})

const responseFor = (decision: InstrumentFilesDecision, raw: InstrumentFilesRaw): InstrumentResult =>
  Match.value(decision).pipe(
    Match.when(
      S.is(InstrumentFilesSkippedOnly),
      () => InstrumentResult.make({ files: [], mutants: [], skipped: [...raw.skipped] }),
    ),
    Match.orElse(() =>
      InstrumentResult.make({
        files: raw.parsed.map((parsed) => printedFile(raw, parsed)),
        mutants: [...raw.mutants],
        skipped: [...raw.skipped],
      })
    ),
  )

const writeInstrumentFiles = (
  output: Result.Result<InstrumentFilesDecision, never>,
  raw: InstrumentFilesRaw,
): Effect.Effect<InstrumentResult, never> =>
  Effect.gen(function*() {
    if (Result.isFailure(output)) {
      return yield* Effect.fail(output.failure)
    }
    return responseFor(output.success, raw)
  })

export const instrumentFilesCell: Cell.Cell<InstrumentFilesInput, InstrumentResult, InstrumentError, never> = Sandwich
  .read(readInstrumentFiles)
  .decode(Sandwich.pure(decodeInstrumentFiles))
  .decide(admitInstrumentFiles)
  .encode(Sandwich.pure((outcome) => Result.succeed(outcome)))
  .write(writeInstrumentFiles)
