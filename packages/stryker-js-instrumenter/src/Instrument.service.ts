import { Instrumenter } from '@systemfsoftware/stryker-js-contracts'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import { disableTypeChecksCell } from './disable-type-checks.cell.js'
import { coreFormatRegistry } from './Format.js'
import type { FormatRegistry } from './Format.schema.js'
import { instrumentFilesCell } from './instrument-files.cell.js'
import {
  FileSchema,
  type InstrumenterOptions,
  InstrumentResult as InstrumentResultSchema,
} from './Instrument.schema.js'

type File = Instrumenter.File

export type { InstrumenterOptions }

const toSchemaFile = (file: File): S.Schema.Type<typeof FileSchema> => ({
  name: Mutant.CanonicalFileName.make(file.name),
  content: file.content,
  mutate: file.mutate,
})

const instrumentDataFirst = (
  files: readonly File[],
  options: InstrumenterOptions,
  registry: FormatRegistry = coreFormatRegistry,
): Effect.Effect<InstrumentResultSchema, Instrumenter.InstrumentError> =>
  instrumentFilesCell.run({ files: files.map(toSchemaFile), options, registry })

export const instrument: {
  (
    files: readonly File[],
    options: InstrumenterOptions,
    registry?: FormatRegistry,
  ): Effect.Effect<InstrumentResultSchema, Instrumenter.InstrumentError>
  (
    options: InstrumenterOptions,
    registry?: FormatRegistry,
  ): (files: readonly File[]) => Effect.Effect<InstrumentResultSchema, Instrumenter.InstrumentError>
} = dual((args: IArguments): boolean => Array.isArray(args[0]), instrumentDataFirst)

const disableTypeChecksDataFirst = (
  file: File,
  registry: FormatRegistry = coreFormatRegistry,
): Effect.Effect<File, Instrumenter.InstrumentError> =>
  disableTypeChecksCell.run({ file: toSchemaFile(file), registry }).pipe(
    Effect.map((disabled: S.Schema.Type<typeof FileSchema>): File => ({ ...file, content: disabled.content })),
    Effect.mapError((cause) =>
      S.is(Instrumenter.InstrumentError)(cause)
        ? cause
        : Instrumenter.InstrumentError.make({ message: `No installed format owns ${file.name}`, cause })
    ),
  )

export const disableTypeChecks: {
  (file: File, registry?: FormatRegistry): Effect.Effect<File, Instrumenter.InstrumentError>
  (registry?: FormatRegistry): (file: File) => Effect.Effect<File, Instrumenter.InstrumentError>
} = dual((args: IArguments): boolean => Predicate.hasProperty(args[0], 'content'), disableTypeChecksDataFirst)
