import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as S from 'effect/Schema'

export class MutationTestCommand extends S.TaggedClass<MutationTestCommand>()('MutationTestCommand', {
  dryRunOnly: S.Boolean,
  allowEmpty: S.Boolean,
  testCount: S.Finite,
  isZero: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    dryRunOnly: 'stryker.mutation_test.dry_run_only',
    allowEmpty: 'stryker.mutation_test.allow_empty',
    testCount: 'stryker.mutation_test.test_count',
  } as const
}
