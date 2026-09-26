import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import { disableTypeChecksCell } from './disable-type-checks.cell.js'
import { coreFormatRegistry, optInMutationsOf } from './Format.js'
import type { FormatRegistry } from './Format.schema.js'
import { instrumentFilesCell } from './instrument-files.cell.js'
import {
  type FileDescription,
  FileSchema,
  type InstrumenterOptions,
  InstrumentError,
  type InstrumentFileSkip,
  InstrumentResult as InstrumentResultSchema,
} from './Instrument.schema.js'
import { CanonicalFileName, type Mutant as ApiMutant } from './Mutant.schema.js'
import { optInMutators } from './Mutator.service.js'

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
  name: CanonicalFileName.make(file.name),
  content: file.content,
  mutate: file.mutate,
})

const KNOWN_OPT_IN_MUTATIONS: readonly string[] = Object.keys(optInMutators)

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
  Option.match(unknownOptInMutationsError(optInMutationsOf(options)), {
    onNone: (): Effect.Effect<void, InstrumentError> => Effect.void,
    onSome: (error): Effect.Effect<void, InstrumentError> => Effect.fail(error),
  })

const instrumentDataFirst = (
  files: readonly File[],
  options: InstrumenterOptions,
  registry: FormatRegistry = coreFormatRegistry,
): Effect.Effect<InstrumentResultSchema, InstrumentError> =>
  refuseUnknownOptInMutations(options).pipe(
    Effect.andThen(instrumentFilesCell.run({ files: files.map(toSchemaFile), options, registry })),
  )

export const instrument: {
  (
    files: readonly File[],
    options: InstrumenterOptions,
    registry?: FormatRegistry,
  ): Effect.Effect<InstrumentResultSchema, InstrumentError>
  (
    options: InstrumenterOptions,
    registry?: FormatRegistry,
  ): (files: readonly File[]) => Effect.Effect<InstrumentResultSchema, InstrumentError>
} = dual((args: IArguments): boolean => Array.isArray(args[0]), instrumentDataFirst)

const disableTypeChecksDataFirst = (
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

export const disableTypeChecks: {
  (file: File, registry?: FormatRegistry): Effect.Effect<File, InstrumentError>
  (registry?: FormatRegistry): (file: File) => Effect.Effect<File, InstrumentError>
} = dual((args: IArguments): boolean => Predicate.hasProperty(args[0], 'content'), disableTypeChecksDataFirst)
