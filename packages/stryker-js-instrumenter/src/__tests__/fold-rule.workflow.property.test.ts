import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'

import { type LocatedDirective, LocatedDirectiveSchema } from '../directives/directive.schema.js'
import { foldRule, FoldRuleCommand } from '../directives/fold-rule.workflow.js'
import { planMutants, PlanMutantsCommand } from '../plan-mutants.workflow.js'

const acted = (located: LocatedDirective, action: 'disable' | 'restore'): LocatedDirective => ({
  ...located,
  directive: { ...located.directive, action },
})

const folding = (
  fold: typeof foldRule,
  rule: readonly LocatedDirective[],
  directive: LocatedDirective,
): readonly LocatedDirective[] => {
  const decided = fold(FoldRuleCommand.make({ rule, directive }))
  return Result.isSuccess(decided) ? decided.success.rule : rule
}

const reachedNameOf = (located: LocatedDirective): string | undefined => located.directive.mutatorNames.at(0)

const silencingReason = (
  rule: readonly LocatedDirective[],
  mutatorName: string,
  line: number,
): string | undefined => {
  const planned = planMutants(
    PlanMutantsCommand.make({
      fileName: 'probe.ts',
      firstIndex: 0,
      offset: { line: 1, columnShift: 0 },
      line,
      mutatorNames: [mutatorName.toLowerCase()],
      excludedMutations: [],
      rule,
      directives: [],
      candidates: [{
        mutatorName,
        replacementCode: 'n - 1',
        location: { start: { line, column: 1 }, end: { line, column: 2 } },
      }],
    }),
  )
  return Result.isSuccess(planned) ? planned.success.mutants.at(0)?.ignoreReason : undefined
}

describe('foldRule', () => {
  it.prop(
    '∀d_Restore_≡FoldedOntoTheEmptyRuleSilencesNoNameItNames',
    { of: [LocatedDirectiveSchema], subject: foldRule },
    (subject, [drawn]) => {
      const restore = acted(drawn, 'restore')
      const name = reachedNameOf(restore)
      return name !== undefined &&
        silencingReason(folding(subject, [], restore), name, restore.governedLine) === undefined
    },
  )

  it.prop(
    '∀d_Disable_≡FoldedOntoTheEmptyRuleSilencesItsNamesWithItsOwnReason',
    { of: [LocatedDirectiveSchema], subject: foldRule },
    (subject, [drawn]) => {
      const disable = acted(drawn, 'disable')
      const name = reachedNameOf(disable)
      return name !== undefined &&
        silencingReason(folding(subject, [], disable), name, disable.governedLine) === disable.directive.reason
    },
  )

  it.prop(
    '∀dd_Directives_≡FoldedInOrderTheLaterReachingDirectiveIsInForce',
    { of: [LocatedDirectiveSchema, LocatedDirectiveSchema], subject: foldRule },
    (subject, [earlier, later]) => {
      const name = reachedNameOf(earlier)
      if (name === undefined) {
        return false
      }
      const { at, governedLine } = earlier
      const first: LocatedDirective = {
        directive: { ...earlier.directive, scope: 'block', mutatorNames: [name] },
        at,
        governedLine,
      }
      const second: LocatedDirective = {
        directive: { ...later.directive, scope: 'block', mutatorNames: [name] },
        at,
        governedLine,
      }
      const expected = second.directive.action === 'disable' ? second.directive.reason : undefined
      return silencingReason(folding(subject, folding(subject, [], first), second), name, governedLine) === expected
    },
  )
})
