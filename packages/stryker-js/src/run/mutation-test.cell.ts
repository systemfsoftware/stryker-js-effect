import { Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'

import { admitMutationTest, MutationTestError } from '../admit-mutation-test.workflow.js'
import { StageError } from '../Run.schema.js'
import type { DryRunDone } from './dry-run.cell.js'
import {
  type MutationTestRaw,
  writeMutationTestDryRunOnly,
  writeMutationTestNoTests,
  writeMutationTestOutcome,
  writeMutationTestProceed,
} from './mutation-test.parts.js'

export type { MutationTestDone } from './mutation-test.parts.js'

export const mutationTestCell = Sandwich.named(
  'stryker.mutation_test',
)((command: DryRunDone) =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const prev = command
    const raw: MutationTestRaw = {
      _tag: 'MutationTestCommand',
      dryRunOnly: prev.options.dryRunOnly,
      allowEmpty: prev.options.allowEmpty,
      testCount: prev.dryRunResult.tests.length,
      isZero: prev.dryRunResult.tests.length === 0,
      prev,
    }
    return raw
  })
).decide(admitMutationTest).write({
  MutationTestDryRunOnly: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestDryRunOnly }),
  MutationTestNoTests: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestNoTests }),
  MutationTestProceed: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestProceed(raw) }),
  MutationTestError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: MutationTestError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'mutationTest', reason: issue })),
})
