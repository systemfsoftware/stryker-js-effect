import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PlanSandboxAcquisitionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/PlanSandboxAcquisition')
type PlanSandboxAcquisitionTypeId = typeof PlanSandboxAcquisitionTypeId

export class SandboxAcquisitionCommand extends S.TaggedClass<SandboxAcquisitionCommand>()('SandboxAcquisitionCommand', {
  inPlace: S.Boolean,
  backupDirectory: S.String,
  symlinkNodeModules: S.Boolean,
  buildCommand: S.UndefinedOr(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const variantFields = { buildCommand: S.Option(S.String) }

export class SandboxInPlaceRestored extends S.TaggedClass<SandboxInPlaceRestored>()(
  'SandboxInPlaceRestored',
  variantFields,
) {
  readonly [PlanSandboxAcquisitionTypeId] = PlanSandboxAcquisitionTypeId
}

export class SandboxInPlaceUnrestored extends S.TaggedClass<SandboxInPlaceUnrestored>()(
  'SandboxInPlaceUnrestored',
  variantFields,
) {
  readonly [PlanSandboxAcquisitionTypeId] = PlanSandboxAcquisitionTypeId
}

export class SandboxCopiedLinked extends S.TaggedClass<SandboxCopiedLinked>()('SandboxCopiedLinked', variantFields) {
  readonly [PlanSandboxAcquisitionTypeId] = PlanSandboxAcquisitionTypeId
}

export class SandboxCopiedUnlinked extends S.TaggedClass<SandboxCopiedUnlinked>()(
  'SandboxCopiedUnlinked',
  variantFields,
) {
  readonly [PlanSandboxAcquisitionTypeId] = PlanSandboxAcquisitionTypeId
}

export const SandboxAcquisitionPlan = S.Union([
  SandboxInPlaceRestored,
  SandboxInPlaceUnrestored,
  SandboxCopiedLinked,
  SandboxCopiedUnlinked,
])
export type SandboxAcquisitionPlan = typeof SandboxAcquisitionPlan.Type

const isNonEmpty = (text: string): boolean => text !== ''

const buildCommandOf = (command: SandboxAcquisitionCommand): Option.Option<string> =>
  Option.filter(Option.fromUndefinedOr(command.buildCommand), isNonEmpty)

const inPlaceOf = (command: SandboxAcquisitionCommand): SandboxAcquisitionPlan =>
  Boolean.match(isNonEmpty(command.backupDirectory), {
    onTrue: (): SandboxAcquisitionPlan => SandboxInPlaceRestored.make({ buildCommand: buildCommandOf(command) }),
    onFalse: (): SandboxAcquisitionPlan => SandboxInPlaceUnrestored.make({ buildCommand: buildCommandOf(command) }),
  })

const copiedOf = (command: SandboxAcquisitionCommand): SandboxAcquisitionPlan =>
  Boolean.match(command.symlinkNodeModules, {
    onTrue: (): SandboxAcquisitionPlan => SandboxCopiedLinked.make({ buildCommand: buildCommandOf(command) }),
    onFalse: (): SandboxAcquisitionPlan => SandboxCopiedUnlinked.make({ buildCommand: buildCommandOf(command) }),
  })

const decide = (command: SandboxAcquisitionCommand): Result.Result<SandboxAcquisitionPlan, never> =>
  Result.succeed(Boolean.match(command.inPlace, { onTrue: () => inPlaceOf(command), onFalse: () => copiedOf(command) }))

export const planSandboxAcquisition = Workflow.make({
  command: SandboxAcquisitionCommand,
  decision: SandboxAcquisitionPlan,
  error: S.Never,
  decide,
})
