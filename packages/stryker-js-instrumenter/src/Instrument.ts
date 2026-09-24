import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import type { FileDescription, Mutant as ApiMutant } from './Mutant.js'
import { optInMutators } from './Mutator.js'

import { disableTypeChecksCell } from './disable-type-checks.cell.js'
import { coreFormatRegistry, type FormatRegistry } from './format-registry.js'
import { instrumentFilesCell } from './instrument-files.cell.js'
import {
  FileSchema,
  type InstrumenterOptions,
  InstrumentError,
  type InstrumentFileSkip,
  InstrumentResult as InstrumentResultSchema,
} from './Instrument.schema.js'

export interface File extends FileDescription {
  name: string
  content: string
}
export interface InstrumentResult {
  files: readonly File[]
  mutants: readonly ApiMutant[]
  skipped: readonly InstrumentFileSkip[]
}

export type { InstrumenterOptions }
export type { InstrumentFileSkip } from './Instrument.schema.js'

const toSchemaFile = (file: File): S.Schema.Type<typeof FileSchema> => ({
  name: file.name,
  content: file.content,
  mutate: file.mutate,
})

const EMPTY_MUTATION_NAMES: readonly string[] = []

const KNOWN_OPT_IN_MUTATIONS: readonly string[] = Object.keys(optInMutators)

const requestedOptInMutations = (options: InstrumenterOptions): readonly string[] =>
  Option.getOrElse(Option.fromNullishOr(options.optInMutations), () => EMPTY_MUTATION_NAMES)

const unknownOptInMutations = (requested: readonly string[]): readonly string[] =>
  requested.filter((name) => !KNOWN_OPT_IN_MUTATIONS.includes(name))

const listNames = (names: readonly string[]): string =>
  Option.match(Option.fromNullishOr(names.at(0)), {
    onNone: () => 'none',
    onSome: () => names.map((name) => `'${name}'`).join(', '),
  })

const unknownOptInMutationsError = (requested: readonly string[]): Option.Option<InstrumentError> =>
  Option.map(
    Option.fromNullishOr(unknownOptInMutations(requested).at(0)),
    () =>
      InstrumentError.make({
        message: `Unknown opt-in mutations: ${listNames(unknownOptInMutations(requested))}. Known opt-in mutations: ${
          listNames(KNOWN_OPT_IN_MUTATIONS)
        }.`,
        cause: undefined,
      }),
  )

const refuseUnknownOptInMutations = (options: InstrumenterOptions): Effect.Effect<void, InstrumentError> =>
  Option.match(unknownOptInMutationsError(requestedOptInMutations(options)), {
    onNone: (): Effect.Effect<void, InstrumentError> => Effect.void,
    onSome: (error): Effect.Effect<void, InstrumentError> => Effect.fail(error),
  })

export const instrument = (
  files: readonly File[],
  options: InstrumenterOptions,
  registry: FormatRegistry = coreFormatRegistry,
): Effect.Effect<InstrumentResultSchema, InstrumentError> =>
  refuseUnknownOptInMutations(options).pipe(
    Effect.andThen(instrumentFilesCell.run({ files: files.map(toSchemaFile), options, registry })),
  )

export const disableTypeChecks = (
  file: File,
  registry: FormatRegistry = coreFormatRegistry,
): Effect.Effect<File, InstrumentError> =>
  disableTypeChecksCell.run({ file: toSchemaFile(file), registry }).pipe(
    Effect.map((disabled: S.Schema.Type<typeof FileSchema>): File => ({ ...file, content: disabled.content })),
    Effect.mapError((cause) =>
      S.is(InstrumentError)(cause)
        ? cause
        : InstrumentError.make({ message: `No installed format owns ${file.name}`, cause })
    ),
  )
