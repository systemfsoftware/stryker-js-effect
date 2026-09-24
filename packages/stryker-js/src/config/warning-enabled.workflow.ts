import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const WarningDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/WarningDecision')
type WarningDecisionTypeId = typeof WarningDecisionTypeId

export class WarningEnabled extends S.TaggedClass<WarningEnabled>()('WarningEnabled', {}) {
  readonly [WarningDecisionTypeId] = WarningDecisionTypeId
}

export class WarningDisabled extends S.TaggedClass<WarningDisabled>()('WarningDisabled', {}) {
  readonly [WarningDecisionTypeId] = WarningDecisionTypeId
}

export type WarningDecision = WarningEnabled | WarningDisabled

export class ResolveWarningEnabledCommand extends S.TaggedClass<ResolveWarningEnabledCommand>()(
  'ResolveWarningEnabledCommand',
  {
    warning: S.Literals(['unknownOptions', 'preprocessorErrors', 'unserializableOptions', 'slow']),
    warnings: S.Union([S.Boolean, S.Record(S.String, S.Unknown)]),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const enabledOf = (command: ResolveWarningEnabledCommand): boolean =>
  Match.value(command.warnings).pipe(
    Match.when(S.is(S.Boolean), (global) => global),
    Match.orElse((configured) => configured[command.warning] === true),
  )

const decide = (command: ResolveWarningEnabledCommand): Result.Result<WarningDecision, never> =>
  Result.succeed(
    Boolean.match(enabledOf(command), {
      onTrue: () => WarningEnabled.make({}),
      onFalse: () => WarningDisabled.make({}),
    }),
  )

export const warningEnabled = Workflow.make({
  command: ResolveWarningEnabledCommand,
  decision: S.Union([WarningEnabled, WarningDisabled]),
  error: S.Never,
  decide,
})