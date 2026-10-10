import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  DryRunCandidate,
  type PriorStatus,
  requireDryRun,
  RequireDryRunCommand,
  type RequireDryRunDecision,
} from '../require-dry-run.workflow.js'

type RequireSubject = (command: RequireDryRunCommand) => Result.Result<RequireDryRunDecision, never>

interface CheckerSettledFields {
  readonly mutants: readonly DryRunCandidate[]
  readonly priorStatuses: readonly PriorStatus[]
  readonly priorFlakyMutantIds: readonly string[]
}

const checkerSettled = ({ mutants, priorStatuses, priorFlakyMutantIds }: CheckerSettledFields): RequireDryRunCommand =>
  RequireDryRunCommand.make({
    dryRunOnly: false,
    ignoreStatic: false,
    hasCheckers: true,
    mutants,
    priorStatuses: [
      ...mutants.map((mutant) => ({ mutantId: mutant.id, status: 'CompileError' as const })),
      ...priorStatuses,
    ],
    priorFlakyMutantIds,
  })

const dependentIdsOf = (subject: RequireSubject, command: RequireDryRunCommand): string =>
  subject(command).pipe(
    Result.getOrThrow,
    Match.value,
    Match.tag('DryRunNeeded', (needed): readonly string[] => needed.dependentMutantIds),
    Match.tag('DryRunSkippable', (): readonly string[] => []),
    Match.exhaustive,
    JSON.stringify,
  )

describe('requireDryRun', () => {
  it.prop(
    '∀c_CheckerSettledCommands_≡AnyOtherPriorStatusMakesEveryMutantDependent',
    { of: [S.NonEmptyArray(DryRunCandidate), Mutant.MutantStatusSchema], subject: requireDryRun },
    (subject, [mutants, status]) => {
      const ids = mutants.map((mutant) => mutant.id)
      const dependent = dependentIdsOf(
        subject,
        checkerSettled({
          mutants,
          priorStatuses: ids.map((mutantId) => ({ mutantId, status })),
          priorFlakyMutantIds: [],
        }),
      )
      return dependent === JSON.stringify(status === 'CompileError' ? [] : ids)
    },
  )

  it.prop(
    '∀c_CheckerSettledCommands_≡APriorFlakeKeepsItsMutantAndEveryStaticMutantDependent',
    { of: [S.NonEmptyArray(DryRunCandidate)], subject: requireDryRun },
    (subject, [mutants]) => {
      const flaky = mutants.filter((_, index) => index % 2 === 0).map((mutant) => mutant.id)
      const flakyIndex: Readonly<Record<string, boolean>> = Object.fromEntries(flaky.map((id) => [id, true]))
      const anyFlake = flaky.length > 0
      const expected = mutants
        .filter((mutant) => flakyIndex[mutant.id] === true || (mutant.static && anyFlake))
        .map((mutant) => mutant.id)
      const dependent = dependentIdsOf(
        subject,
        checkerSettled({ mutants, priorStatuses: [], priorFlakyMutantIds: flaky }),
      )
      return dependent === JSON.stringify(expected)
    },
  )
})
