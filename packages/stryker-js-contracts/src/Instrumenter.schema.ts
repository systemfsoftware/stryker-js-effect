import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as S from 'effect/Schema'

export class InstrumentError
  extends S.TaggedError<InstrumentError>('@systemfsoftware/stryker-js-contracts/Instrumenter.schema/InstrumentError')(
    'InstrumentError',
    {
      message: S.String,
      cause: S.Defect(),
    },
  )
{
  override get message(): string {
    return Boolean.match(this.message.length === 0, {
      onTrue: () => 'Instrumenter failure',
      onFalse: () => this.message,
    })
  }
}

export const MutateDescriptionSchema = S.Union([S.Boolean, S.Array(Mutant.Location)])

export type MutateDescription = typeof MutateDescriptionSchema.Type

export interface FileDescription {
  readonly mutate: MutateDescription
}

export type FileDescriptions = Record<string, FileDescription>

export interface File extends FileDescription {
  readonly name: string
  readonly content: string
}

export class InstrumentFileSkip extends S.TaggedClass<InstrumentFileSkip>()('InstrumentFileSkip', {
  file: S.String,
  extension: S.String,
  reason: S.String,
}) {}

export interface InstrumentResult {
  readonly files: readonly File[]
  readonly mutants: readonly Mutant.Mutant[]
  readonly skipped: readonly InstrumentFileSkip[]
}

/**
 * One format a driver can instrument, in the driver's precedence order: the
 * first claim naming an extension owns it, and a later claim on the same
 * extension is shadowed.
 */
export interface ClaimedFormat {
  readonly formatId: string
  readonly ownerModule: string
  readonly ownerVersion: string
  readonly language: string
  readonly extensions: readonly string[]
}
