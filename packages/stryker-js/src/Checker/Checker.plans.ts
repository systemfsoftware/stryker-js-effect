import { Checker, Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'

import type { CheckerContractBroken } from '../admit-checker-answer.workflow.js'
import { checkCell } from './check.cell.js'
import { checkGroupedCell } from './Checker.cell.js'
import { type CheckerCrash, type CheckerResourceService } from './Checker.handle.js'
import {
  type CheckedPlansResult,
  type CheckerCellError,
  checkRequestOf,
  type GroupedPlansResult,
} from './Checker.protocol.js'
import { groupCell } from './group.cell.js'

export const groupPlans: {
  (
    checker: CheckerResourceService,
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): Effect.Effect<GroupedPlansResult, CheckerCellError>
  (
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): (checker: CheckerResourceService) => Effect.Effect<GroupedPlansResult, CheckerCellError>
} = dual(
  3,
  (checker: CheckerResourceService, checkerName: string, plans: readonly Mutant.RunPlan[]) =>
    groupCell.run(checkRequestOf({ checker, checkerName, plans })),
)

export const checkPlans: {
  (
    checker: CheckerResourceService,
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): Effect.Effect<CheckedPlansResult, CheckerCellError>
  (
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): (checker: CheckerResourceService) => Effect.Effect<CheckedPlansResult, CheckerCellError>
} = dual(
  3,
  (checker: CheckerResourceService, checkerName: string, plans: readonly Mutant.RunPlan[]) =>
    checkCell.run(checkRequestOf({ checker, checkerName, plans })),
)

export const checkGroupedPlans: {
  (
    checker: CheckerResourceService,
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): Effect.Effect<
    readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[],
    CheckerCrash | Checker.CheckerFailed | CheckerContractBroken
  >
  (
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): (
    checker: CheckerResourceService,
  ) => Effect.Effect<
    readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[],
    CheckerCrash | Checker.CheckerFailed | CheckerContractBroken
  >
} = dual(
  3,
  (checker: CheckerResourceService, checkerName: string, plans: readonly Mutant.RunPlan[]) =>
    checkGroupedCell.run(checkRequestOf({ checker, checkerName, plans })),
)
