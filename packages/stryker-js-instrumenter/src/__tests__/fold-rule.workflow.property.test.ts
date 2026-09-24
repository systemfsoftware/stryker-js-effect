import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'

import { type LocatedDirective, LocatedDirectiveSchema } from '../directives/directive.schema.js'
import {
  DisableFolded,
  type FoldedRule,
  foldRule,
  FoldRuleCommand,
  RestoreFolded,
} from '../directives/fold-rule.workflow.js'
import { planMutants, PlanMutantsCommand } from '../plan-mutants.workflow.js'

const RuleFoldTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-instrumenter/RuleFold')

const hasBrand = (folded: FoldedRule): boolean => Object.getOwnPropertySymbols(folded).includes(RuleFoldTypeId)

const acted = (located: LocatedDirective, action: 'disable' | 'restore'): LocatedDirective => ({
  directive: { ...located.directive, action },
  at: located.at,
})

const foldedOnto = (rule: readonly LocatedDirective[], directive: LocatedDirective): readonly LocatedDirective[] => {
  const decided = foldRule(FoldRuleCommand.make({ rule, directive }))
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
      offset: { line: 0, column: 0 },
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
    '∀d_Brand_∈Decision',
    [DisableFolded, RestoreFolded],
    ([disable, restore]) => hasBrand(disable) && hasBrand(restore),
  )

  it.prop('∀d_Restore_≡FoldedOntoTheEmptyRuleSilencesNoNameItNames', [LocatedDirectiveSchema], ([drawn]) => {
    const restore = acted(drawn, 'restore')
    const name = reachedNameOf(restore)
    return name !== undefined && silencingReason(foldedOnto([], restore), name, restore.at.line) === undefined
  })

  it.prop('∀d_Disable_≡FoldedOntoTheEmptyRuleSilencesItsNamesWithItsOwnReason', [LocatedDirectiveSchema], ([drawn]) => {
    const disable = acted(drawn, 'disable')
    const name = reachedNameOf(disable)
    return name !== undefined &&
      silencingReason(foldedOnto([], disable), name, disable.at.line) === disable.directive.reason
  })

  it.prop('∀dd_Directives_≡FoldedInOrderTheLaterReachingDirectiveIsInForce', [
    LocatedDirectiveSchema,
    LocatedDirectiveSchema,
  ], ([earlier, later]) => {
    const name = reachedNameOf(earlier)
    if (name === undefined) {
      return false
    }
    const at = earlier.at
    const first: LocatedDirective = { directive: { ...earlier.directive, scope: 'block', mutatorNames: [name] }, at }
    const second: LocatedDirective = { directive: { ...later.directive, scope: 'block', mutatorNames: [name] }, at }
    const expected = second.directive.action === 'disable' ? second.directive.reason : undefined
    return silencingReason(foldedOnto(foldedOnto([], first), second), name, at.line) === expected
  })
})
