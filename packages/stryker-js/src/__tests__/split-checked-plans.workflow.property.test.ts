import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type CheckedHistoryEntry,
  CheckedHistoryEntry as CheckedHistoryEntrySchema,
} from '../../tests/__fixtures__/partition-checked-plans-law.fixture.js'
import { splitCheckedPlans } from '../Checker/checker-pool.handle.js'
import {
  CheckedPlanFailed,
  CheckedPlanPassed,
  partitionCheckedPlans,
  PartitionCheckedPlansCommand,
} from '../Checker/partition-checked-plans.workflow.js'

type CheckedPlans = readonly (readonly [Mutant.MutantRunPlan, Checker.CheckResult])[]

const runPlanOf = (mutantId: string, netTime: number): Mutant.MutantRunPlan => {
  const mutant = Mutant.Mutant.make({
    id: Mutant.MutantId.make(mutantId),
    fileName: Mutant.CanonicalFileName.make(`src/${mutantId}.ts`),
    mutatorName: Mutant.MutatorName.make(`${mutantId}-mutator`),
    replacement: '',
    location: { start: { line: netTime + 1, column: 0 }, end: { line: netTime + 1, column: 1 } },
  })
  return {
    plan: 'Run',
    mutant,
    netTime,
    runOptions: {
      timeout: 0,
      disableBail: false,
      activeMutant: mutant,
      sandboxFileName: `src/${mutantId}.ts`,
      mutantActivation: 'runtime',
      reloadEnvironment: false,
    },
  }
}

const resultOf = (outcome: CheckedHistoryEntry['outcome']): Checker.CheckResult =>
  outcome === 'passed' ? { status: 'passed' } : { status: 'compileError', reason: outcome }

const checkedOf = (entries: readonly CheckedHistoryEntry[]): CheckedPlans =>
  entries.map((entry, netTime) => [runPlanOf(entry.mutantId, netTime), resultOf(entry.outcome)] as const)

const commandOf = (checked: CheckedPlans): PartitionCheckedPlansCommand =>
  PartitionCheckedPlansCommand.make({ checked: checked.map(([plan, result]) => [plan.mutant.id, result] as const) })

const failedReasonOf = (result: Checker.CheckResult): string => result.status === 'compileError' ? result.reason : ''

const referenceOf = (checked: CheckedPlans) => ({
  passedPlans: checked.filter(([, result]) => result.status === 'passed').map(([plan]) => plan.netTime),
  failedChecks: checked
    .filter(([, result]) => result.status !== 'passed')
    .map(([plan, result]) => `${plan.netTime}:${failedReasonOf(result)}`),
})

const reportedOf = (split: {
  readonly passedPlans: readonly Mutant.MutantRunPlan[]
  readonly failedChecks: readonly (readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult])[]
}) => ({
  passedPlans: split.passedPlans.map((plan) => plan.netTime),
  failedChecks: split.failedChecks.map(([plan, result]) => `${plan.netTime}:${result.reason}`),
})

describe('splitCheckedPlans', () => {
  it.effect.prop(
    '∀entries_SplitCheckedPlans_≡ReferencePartition',
    { of: [S.Array(CheckedHistoryEntrySchema)], subject: splitCheckedPlans },
    (subject, [entries]) => {
      const checked = checkedOf(entries)
      return Effect.map(
        subject(checked),
        (split) => JSON.stringify(reportedOf(split)) === JSON.stringify(referenceOf(checked)),
      )
    },
  )

  it.prop(
    '∀e_CheckedPlan_≡CarriesItsOwnEntryIndex',
    { of: [S.Array(CheckedHistoryEntrySchema)], subject: partitionCheckedPlans },
    (subject, [entries]) =>
      Result.match(subject(commandOf(checkedOf(entries))), {
        onFailure: () => false,
        onSuccess: (decisions) =>
          decisions.length === entries.length &&
          entries.every((entry, entryIndex) =>
            Option.match(Array.get(decisions, entryIndex), {
              onNone: () => false,
              onSome: (decision) =>
                decision.entryIndex === entryIndex &&
                decision.mutantId === entry.mutantId &&
                (entry.outcome === 'passed'
                  ? S.is(CheckedPlanPassed)(decision)
                  : S.is(CheckedPlanFailed)(decision) &&
                    decision.reason === entry.outcome &&
                    decision.result.reason === entry.outcome),
            })
          ),
      }),
  )
})
