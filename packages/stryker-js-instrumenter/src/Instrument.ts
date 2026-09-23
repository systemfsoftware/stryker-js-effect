import * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'
import type { FileDescription, Mutant as ApiMutant } from './Mutant.js'

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

export const instrument = (
  files: readonly File[],
  options: InstrumenterOptions,
  registry: FormatRegistry = coreFormatRegistry,
): Effect.Effect<InstrumentResultSchema, InstrumentError> =>
  instrumentFilesCell.run({ files: files.map(toSchemaFile), options, registry })

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
