import type { FileDescription, Mutant as ApiMutant } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'

import { disableTypeChecksCell } from './disable-type-checks.cell.js'
import { coreFormatRegistry, type FormatRegistry } from './format-registry.js'
import { instrumentFilesCell } from './instrument-files.cell.js'
import {
  type FileSchema,
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

const toSchemaFile = (file: File): typeof FileSchema.Type => ({
  name: file.name,
  content: file.content,
  mutate: file.mutate,
})

export const instrument = (
  files: readonly File[],
  options: InstrumenterOptions,
  registry: FormatRegistry = coreFormatRegistry,
): Effect.Effect<typeof InstrumentResultSchema.Type, InstrumentError> =>
  instrumentFilesCell.run({ files: files.map(toSchemaFile), options, registry })

export async function disableTypeChecks(file: File, registry: FormatRegistry = coreFormatRegistry): Promise<File> {
  const disabled = await Effect.runPromise(disableTypeChecksCell.run({ file: toSchemaFile(file), registry }))
  return { ...file, content: disabled.content }
}
