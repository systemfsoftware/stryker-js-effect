import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  NoPluginDeclarations,
  planPluginLoad,
  type PluginDeclaration,
  PluginDeclarationSchema,
  PluginDeclarationsPlanned,
  PluginLoadCommand,
} from '../plan-plugin-load.workflow.js'

const declarationArb: Arbitrary.Arbitrary<PluginDeclaration> = Arbitrary.schema(PluginDeclarationSchema).pipe(
  Arbitrary.flatMap((declaration) =>
    Arbitrary.map(Arbitrary.schema(S.Literals(['alpha', 'beta'])), (name) => ({
      ...declaration,
      plugin: { ...declaration.plugin, name },
    }))
  ),
)

const nonEmptyDeclarationsArb = Arbitrary.array(declarationArb, { minLength: 1, maxLength: 6 })

const declarationsArb = Arbitrary.all([Arbitrary.schema(S.Boolean), nonEmptyDeclarationsArb]).pipe(
  Arbitrary.map(([empty, declarations]) => (empty ? [] : [...declarations])),
)

const shadowingDeclarationsArb = Arbitrary.all([declarationArb, nonEmptyDeclarationsArb]).pipe(
  Arbitrary.map(([shadowed, declarations]) => [shadowed, ...declarations, shadowed]),
)

const keyOf = (declaration: PluginDeclaration): string =>
  `${declaration.plugin.kind}:${declaration.plugin.name}:${declaration.moduleName}:${declaration.entryIndex}`

const shadowKeyOf = (declaration: PluginDeclaration): string => `${declaration.plugin.kind}:${declaration.plugin.name}`

const expectedWinnersOf = (declarations: readonly PluginDeclaration[]): readonly PluginDeclaration[] =>
  declarations.filter((declaration, position) =>
    declarations.slice(position + 1).every((later) => shadowKeyOf(later) !== shadowKeyOf(declaration))
  )

describe('planPluginLoad', () => {
  it.prop(
    '∀ds_Declarations_≡EmptinessSelectsNoPluginDeclarations',
    { of: [declarationsArb], subject: planPluginLoad },
    (subject, [declarations]) => {
      const result = subject(PluginLoadCommand.make({ declarations: [...declarations] }))
      if (!Result.isSuccess(result)) {
        return false
      }
      return declarations.length === 0
        ? S.is(NoPluginDeclarations)(result.success)
        : S.is(PluginDeclarationsPlanned)(result.success)
    },
  )

  it.prop(
    '∀ds_Declarations_≡LastDeclarationPerKindAndNameWins',
    { of: [shadowingDeclarationsArb], subject: planPluginLoad },
    (subject, [declarations]) => {
      const result = subject(PluginLoadCommand.make({ declarations: [...declarations] }))
      if (!Result.isSuccess(result) || !S.is(PluginDeclarationsPlanned)(result.success)) {
        return false
      }
      const winners = result.success.winners.map(keyOf)
      const expected = expectedWinnersOf(declarations).map(keyOf)
      return (
        JSON.stringify(winners) === JSON.stringify(expected) &&
        result.success.shadowings.length === declarations.length - expected.length
      )
    },
  )
})
