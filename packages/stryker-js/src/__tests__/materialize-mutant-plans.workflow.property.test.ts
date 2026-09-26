import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  MaterializeMutantPlanCommand,
  materializeMutantPlans,
  MutantEarlyResultPlanMaterialized,
  MutantRunPlanMaterialized,
} from '../materialize-mutant-plans.workflow.js'
import { PlannedEarlyResultMutant, PlannedRunMutant } from '../plan-mutant-tests.workflow.js'

const runCommandArb = Arbitrary.all([Arbitrary.schema(Mutant.Mutant), Arbitrary.schema(PlannedRunMutant)]).pipe(
  Arbitrary.map(([mutant, plan]) => MaterializeMutantPlanCommand.make({ mutant, plan })),
)

const earlyCommandArb = Arbitrary.all([Arbitrary.schema(Mutant.Mutant), Arbitrary.schema(PlannedEarlyResultMutant)])
  .pipe(Arbitrary.map(([mutant, plan]) => MaterializeMutantPlanCommand.make({ mutant, plan })))

const sharesSourceFields = (materialized: Mutant.Mutant, original: Mutant.Mutant) =>
  materialized.id === original.id &&
  materialized.fileName === original.fileName &&
  materialized.mutatorName === original.mutatorName &&
  materialized.replacement === original.replacement &&
  Equal.equals(materialized.location, original.location)

describe('materializeMutantPlans', () => {
  it.prop(
    '∀r_PlannedRun_≡MaterializesRunPlan',
    { of: [runCommandArb], subject: materializeMutantPlans },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          S.is(PlannedRunMutant)(command.plan) &&
          S.is(MutantRunPlanMaterialized)(decision) &&
          sharesSourceFields(decision.plan.mutant, command.mutant) &&
          decision.plan.mutant.static === (command.plan.static ?? command.mutant.static) &&
          Equal.equals(decision.plan.mutant.coveredBy, command.plan.coveredBy ?? command.mutant.coveredBy) &&
          decision.plan.netTime === command.plan.netTime &&
          decision.plan.runOptions.activeMutant.id === command.mutant.id &&
          decision.plan.runOptions.timeout === command.plan.runOptions.timeout &&
          decision.plan.runOptions.mutantActivation === command.plan.runOptions.mutantActivation &&
          decision.plan.runOptions.sandboxFileName === command.plan.runOptions.sandboxFileName &&
          decision.plan.runOptions.disableBail === command.plan.runOptions.disableBail &&
          decision.plan.runOptions.reloadEnvironment === command.plan.runOptions.reloadEnvironment &&
          Equal.equals(decision.plan.runOptions.testFilter, command.plan.runOptions.testFilter) &&
          decision.plan.runOptions.hitLimit === command.plan.runOptions.hitLimit,
      }),
  )

  it.prop(
    '∀e_PlannedEarly_≡MaterializesEarlyResultPlan',
    { of: [earlyCommandArb], subject: materializeMutantPlans },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          S.is(PlannedEarlyResultMutant)(command.plan) &&
          S.is(MutantEarlyResultPlanMaterialized)(decision) &&
          sharesSourceFields(decision.plan.mutant, command.mutant) &&
          decision.plan.mutant.status === command.plan.status &&
          decision.plan.mutant.statusReason === (command.plan.statusReason ?? command.mutant.statusReason),
      }),
  )
})
