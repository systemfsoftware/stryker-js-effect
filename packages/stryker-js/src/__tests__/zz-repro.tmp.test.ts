import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import { planMutantTests } from '../plan-mutant-tests.workflow.js'

describe('repro', () => {
  it.prop('repro', [MutantTestPlanCommand], ([command]) => {
    const out = planMutantTests(command)
    return Result.match(out, {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.length === command.mutants.length &&
        decisions.every((d, i) => d.mutantId === command.mutants[i]?.id),
    })
  })
})
