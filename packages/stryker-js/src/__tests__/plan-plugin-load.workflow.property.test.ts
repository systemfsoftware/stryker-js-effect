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

const EMPTY_DECLARATIONS: readonly PluginDeclaration[] = []

const declarationsArb = Arbitrary.array(Arbitrary.schema(PluginDeclarationSchema), { minLength: 1, maxLength: 4 })

const keyOf = (declaration: PluginDeclaration): string =>
  `${declaration.plugin.kind}:${declaration.plugin.name}:${declaration.moduleName}:${declaration.entryIndex}`

const expectedWinnersOf = (declarations: readonly PluginDeclaration[]): readonly PluginDeclaration[] => {
  const lastPositionByName = new Map<string, number>()
  declarations.forEach((declaration, position) =>
    lastPositionByName.set(`${declaration.plugin.kind}:${declaration.plugin.name}`, position)
  )
  return declarations.filter(
    (declaration, position) =>
      lastPositionByName.get(`${declaration.plugin.kind}:${declaration.plugin.name}`) === position,
  )
}

describe('planPluginLoad', () => {
  it.prop(
    '∀ds_Declarations_≡NoDeclarationsIsNoPluginDeclarations',
    { of: [Arbitrary.Constant(EMPTY_DECLARATIONS)], subject: planPluginLoad },
    (subject, [declarations]) => {
      const result = subject(PluginLoadCommand.make({ declarations: [...declarations] }))
      return Result.isSuccess(result) && S.is(NoPluginDeclarations)(result.success)
    },
  )

  it.prop(
    '∀ds_Declarations_≡LastDeclarationPerKindAndNameWins',
    { of: [declarationsArb], subject: planPluginLoad },
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
