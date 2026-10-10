import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { BudgetBaseline, BudgetBaselineSchemaVersion } from './BudgetBaseline.schema.js'

const BUDGET_EXIT_CLASS = 'VerdictFail' satisfies Plugin.ExitClass
const BUDGET_REMEDIATION = 'accept the new cost with `stryker gate --update-budget-baseline`, or speed the run up'

export class BudgetGateCommand extends S.TaggedClass<BudgetGateCommand>()('BudgetGateCommand', {
  actualSeconds: Report.NonNegativeFinite,
  baseline: S.NullOr(BudgetBaseline),
  tolerance: Report.NonNegativeFinite,
  updateBaseline: S.Boolean,
  baselineFile: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const BudgetGateTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/BudgetGateDecision')
type BudgetGateTypeId = typeof BudgetGateTypeId

export class BudgetWithin extends S.TaggedClass<BudgetWithin>()('BudgetWithin', {
  baseline: S.NullOr(BudgetBaseline),
}) {
  readonly [BudgetGateTypeId] = BudgetGateTypeId
}

export const BudgetGateDecision = S.Union([BudgetWithin])
export type BudgetGateDecision = typeof BudgetGateDecision.Type

export class BudgetExceeded extends S.TaggedError<BudgetExceeded>()('BudgetExceeded', {
  baselineSeconds: Report.NonNegativeFinite,
  allowedSeconds: Report.NonNegativeFinite,
  actualSeconds: Report.NonNegativeFinite,
  tolerance: Report.NonNegativeFinite,
}) {
  readonly exitClass = BUDGET_EXIT_CLASS

  override get message(): string {
    return [
      `stryker gate: run took ${this.actualSeconds.toFixed(2)}s, over the ${this.allowedSeconds.toFixed(2)}s budget`,
      `  budget baseline ${this.baselineSeconds.toFixed(2)}s + ${
        (this.tolerance * 100).toFixed(0)
      }% tolerance, actual ${this.actualSeconds.toFixed(2)}s`,
      BUDGET_REMEDIATION,
    ].join('\n')
  }
}

export class BudgetInputUnusable extends S.TaggedError<BudgetInputUnusable>()('BudgetInputUnusable', {
  reason: S.String,
}) {
  readonly exitClass = 'ConfigError' satisfies Plugin.ExitClass

  override get message(): string {
    return `stryker gate: ${this.reason}`
  }
}

const allowedSecondsOf = (baselineSeconds: number, tolerance: number): number => baselineSeconds * (1 + tolerance)

const withinOrExceeded = (
  command: BudgetGateCommand,
  baseline: BudgetBaseline,
): Result.Result<BudgetGateDecision, BudgetExceeded> => {
  const allowedSeconds = allowedSecondsOf(baseline.actualSeconds, command.tolerance)
  return Boolean.match(command.actualSeconds > allowedSeconds, {
    onTrue: () =>
      Result.fail(
        BudgetExceeded.make({
          baselineSeconds: baseline.actualSeconds,
          allowedSeconds,
          actualSeconds: command.actualSeconds,
          tolerance: command.tolerance,
        }),
      ),
    onFalse: () => Result.succeed(BudgetWithin.make({ baseline: null })),
  })
}

const updated = (command: BudgetGateCommand): BudgetWithin =>
  BudgetWithin.make({
    baseline: BudgetBaseline.make({
      schemaVersion: BudgetBaselineSchemaVersion.literal,
      actualSeconds: command.actualSeconds,
    }),
  })

const baselineUnusable = (baselineFile: string): BudgetInputUnusable =>
  BudgetInputUnusable.make({
    reason:
      `no usable budget baseline at ${baselineFile} (missing or undecodable); write one with \`stryker gate --update-budget-baseline\``,
  })

const decide = (
  command: BudgetGateCommand,
): Result.Result<BudgetGateDecision, BudgetExceeded | BudgetInputUnusable> =>
  Boolean.match(command.updateBaseline, {
    onTrue: () => Result.succeed(updated(command)),
    onFalse: () =>
      Option.match(Option.fromNullishOr(command.baseline), {
        onNone: () => Result.fail(baselineUnusable(command.baselineFile)),
        onSome: (baseline) => withinOrExceeded(command, baseline),
      }),
  })

export const budgetGate = Workflow.make({
  command: BudgetGateCommand,
  decision: BudgetGateDecision,
  error: S.Union([BudgetExceeded, BudgetInputUnusable]),
  decide,
})
