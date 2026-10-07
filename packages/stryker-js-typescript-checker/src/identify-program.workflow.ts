import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ProgramFile, programKeyOf } from './program-digest.schema.js'

export class IdentifyProgramCommand extends S.TaggedClass<IdentifyProgramCommand>()('IdentifyProgramCommand', {
  typescriptVersion: S.String,
  checkerVersion: S.String,
  checkerOptionsJson: S.String,
  sourceFiles: S.Array(ProgramFile),
  tsconfigs: S.Array(ProgramFile),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const IdentifyTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/IdentifyProgram')
type IdentifyTypeId = typeof IdentifyTypeId

export class ProgramIdentified extends S.TaggedClass<ProgramIdentified>()('ProgramIdentified', {
  key: S.String,
}) {
  readonly [IdentifyTypeId] = IdentifyTypeId
}

export class ProgramUnidentified extends S.TaggedClass<ProgramUnidentified>()('ProgramUnidentified', {
  reason: S.String,
}) {
  readonly [IdentifyTypeId] = IdentifyTypeId
}

export const ProgramIdentity = S.Union([ProgramIdentified, ProgramUnidentified])
export type ProgramIdentity = typeof ProgramIdentity.Type

const decide = (command: IdentifyProgramCommand): Result.Result<ProgramIdentity, never> =>
  Boolean.match(command.sourceFiles.length === 0, {
    onTrue: () => Result.succeed(ProgramUnidentified.make({ reason: 'the program has no source files' })),
    onFalse: () => Result.succeed(ProgramIdentified.make({ key: programKeyOf(command) })),
  })

export const identifyProgram = Workflow.make({
  command: IdentifyProgramCommand,
  decision: ProgramIdentity,
  error: S.Never,
  decide,
})
