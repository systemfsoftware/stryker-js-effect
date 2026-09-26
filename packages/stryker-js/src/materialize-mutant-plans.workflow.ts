import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlannedEarlyResultMutant, PlannedRunMutant } from './plan-mutant-tests.workflow.js'

const PlanRunOptionsSchema = S.Struct({
  timeout: S.Finite,
  disableBail: S.Boolean,
  activeMutant: Mutant.Mutant,
  sandboxFileName: S.String,
  mutantActivation: S.Literals(['runtime', 'static']),
  reloadEnvironment: S.Boolean,
  testFilter: S.String.pipe(S.Array, S.optionalKey),
  hitLimit: S.optionalKey(S.Finite),
})

const RunPlanSchema = S.Struct({
  plan: S.Literal('Run'),
  mutant: Mutant.Mutant,
  runOptions: PlanRunOptionsSchema,
  netTime: S.Finite,
})

const EarlyResultPlanSchema = S.Struct({
  plan: S.Literal('EarlyResult'),
  mutant: Mutant.Mutant,
})

const MaterializedPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MaterializedPlan')
type MaterializedPlanTypeId = typeof MaterializedPlanTypeId

export class MutantRunPlanMaterialized extends S.TaggedClass<MutantRunPlanMaterialized>()('MutantRunPlanMaterialized', {
  plan: RunPlanSchema,
}) {
  readonly [MaterializedPlanTypeId] = MaterializedPlanTypeId
}

export class MutantEarlyResultPlanMaterialized extends S.TaggedClass<MutantEarlyResultPlanMaterialized>()(
  'MutantEarlyResultPlanMaterialized',
  { plan: EarlyResultPlanSchema },
) {
  readonly [MaterializedPlanTypeId] = MaterializedPlanTypeId
}

export type MaterializedMutantPlan = MutantRunPlanMaterialized | MutantEarlyResultPlanMaterialized

export class MaterializeMutantPlanCommand extends S.TaggedClass<MaterializeMutantPlanCommand>()(
  'MaterializeMutantPlanCommand',
  {
    mutant: Mutant.Mutant,
    plan: S.Union([PlannedRunMutant, PlannedEarlyResultMutant]),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const firstDefined = <Value>(first: Value | undefined, second: Value | undefined) =>
  Option.getOrElse(Option.fromNullishOr(first), () => second)

const materializeMutant = (
  original: Mutant.Mutant,
  decided: {
    readonly status?: Mutant.Mutant['status'] | undefined
    readonly statusReason?: string | undefined
    readonly static?: boolean | undefined
    readonly coveredBy?: readonly string[] | undefined
  },
): Mutant.Mutant => ({
  _tag: 'Mutant',
  id: original.id,
  fileName: original.fileName,
  mutatorName: original.mutatorName,
  replacement: original.replacement,
  location: original.location,
  ...Option.match(Option.fromUndefinedOr(firstDefined(decided.status, original.status)), {
    onNone: () => ({} as const),
    onSome: (status) => ({ status } as const),
  }),
  ...Option.match(Option.fromUndefinedOr(firstDefined(decided.statusReason, original.statusReason)), {
    onNone: () => ({} as const),
    onSome: (statusReason) => ({ statusReason } as const),
  }),
  ...Option.match(Option.fromUndefinedOr(firstDefined(decided.static, original.static)), {
    onNone: () => ({} as const),
    onSome: (isStatic) => ({ static: isStatic } as const),
  }),
  ...Option.match(Option.fromUndefinedOr(firstDefined(decided.coveredBy, original.coveredBy)), {
    onNone: () => ({} as const),
    onSome: (coveredBy) => ({ coveredBy } as const),
  }),
  ...Option.match(Option.fromUndefinedOr(original.testsCompleted), {
    onNone: () => ({} as const),
    onSome: (testsCompleted) => ({ testsCompleted } as const),
  }),
  ...Option.match(Option.fromUndefinedOr(original.description), {
    onNone: () => ({} as const),
    onSome: (description) => ({ description } as const),
  }),
})

const runPlanOf = (mutant: Mutant.Mutant, run: PlannedRunMutant) => {
  const activeMutant = materializeMutant(mutant, { static: run.static, coveredBy: run.coveredBy })
  return {
    plan: 'Run' as const,
    mutant: activeMutant,
    netTime: run.netTime,
    runOptions: {
      activeMutant,
      mutantActivation: run.runOptions.mutantActivation,
      timeout: run.runOptions.timeout,
      sandboxFileName: run.runOptions.sandboxFileName,
      disableBail: run.runOptions.disableBail,
      reloadEnvironment: run.runOptions.reloadEnvironment,
      ...Option.match(Option.fromUndefinedOr(run.runOptions.testFilter), {
        onNone: () => ({} as const),
        onSome: (testFilter) => ({ testFilter } as const),
      }),
      ...Option.match(Option.fromUndefinedOr(run.runOptions.hitLimit), {
        onNone: () => ({} as const),
        onSome: (hitLimit) => ({ hitLimit } as const),
      }),
    },
  }
}

const earlyResultPlanOf = (mutant: Mutant.Mutant, early: PlannedEarlyResultMutant) => ({
  plan: 'EarlyResult' as const,
  mutant: materializeMutant(mutant, {
    status: early.status,
    statusReason: early.statusReason,
    static: early.static,
    coveredBy: early.coveredBy,
  }),
})

const decide = (command: MaterializeMutantPlanCommand): Result.Result<MaterializedMutantPlan, never> =>
  Match.value(command.plan).pipe(
    Match.tag(
      'PlannedRunMutant',
      (run) => Result.succeed(MutantRunPlanMaterialized.make({ plan: runPlanOf(command.mutant, run) })),
    ),
    Match.tag(
      'PlannedEarlyResultMutant',
      (early) =>
        Result.succeed(MutantEarlyResultPlanMaterialized.make({ plan: earlyResultPlanOf(command.mutant, early) })),
    ),
    Match.exhaustive,
  )

export const materializeMutantPlans = Workflow.make({
  command: MaterializeMutantPlanCommand,
  decision: S.Union([MutantRunPlanMaterialized, MutantEarlyResultPlanMaterialized]),
  error: S.Never,
  decide,
})
