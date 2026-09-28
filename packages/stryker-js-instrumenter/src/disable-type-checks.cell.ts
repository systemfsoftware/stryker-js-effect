import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'

import { resolutionCommandOf, spliceForAssigned } from './Format.js'
import type { FormatRegistry } from './Format.schema.js'
import { type FileSchema, InstrumentError } from './Instrument.schema.js'
import { FormatOverrideUnclaimed, type FormatResolutionCommand, resolveFormat } from './resolve-format.workflow.js'

export interface DisableTypeChecksInput {
  readonly file: typeof FileSchema.Type
  readonly registry: FormatRegistry
}

type DisableTypeChecksRaw = typeof FormatResolutionCommand.Encoded & {
  readonly version: 'disable-type-checks'
  readonly file: typeof FileSchema.Type
  readonly registry: FormatRegistry
}

const readDisable = (input: DisableTypeChecksInput): Effect.Effect<DisableTypeChecksRaw, never> =>
  Effect.sync(() => {
    const command = resolutionCommandOf(input.registry, input.file.name)
    return {
      _tag: 'FormatResolutionCommand',
      fileName: command.fileName,
      extension: command.extension,
      formatId: command.formatId,
      claims: command.claims,
      version: 'disable-type-checks',
      file: input.file,
      registry: input.registry,
    }
  })

export const disableTypeChecksCell: Cell.Cell<
  DisableTypeChecksInput,
  typeof FileSchema.Type,
  InstrumentError | FormatOverrideUnclaimed,
  never
> = Sandwich.named(SpanTaxonomy.Spans.instrumentDisableTypeChecks.name)(
  (input: DisableTypeChecksInput) => readDisable(input),
)
  .decide(resolveFormat)
  .write({
    FormatAssigned: (assigned, raw): Effect.Effect<typeof FileSchema.Type, InstrumentError> =>
      spliceForAssigned({ file: raw.file, registry: raw.registry, formatId: assigned.formatId }),
    FormatSkipped: (_skipped, raw) => Effect.succeed(raw.file),
    FormatOverrideUnclaimed: (failure) => Effect.fail(FormatOverrideUnclaimed.make(failure)),
    CommandRejected: ({ issue }) => Effect.fail(InstrumentError.make({ message: issue, cause: new Error(issue) })),
  })
