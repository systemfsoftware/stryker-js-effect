import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import type * as S from 'effect/Schema'

import { PlanDefineFixtureSchema } from '../../../../tests/__fixtures__/environments.schema.js'
import { planDefine, PlanDefineCommand } from '../plan-define.workflow.js'

type FixtureCommand = S.Schema.Type<typeof PlanDefineFixtureSchema>
type FixtureValue = FixtureCommand['define'][string]

interface OracleSplit {
  readonly globals: ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly value: FixtureValue }>
  readonly processEnvironment: ReadonlyArray<{ readonly name: string; readonly value: string }>
}

const oracleOf = (command: FixtureCommand): OracleSplit => {
  const globals: Array<{ readonly path: ReadonlyArray<string>; readonly value: FixtureValue }> = []
  const processEnvironment: Array<{ readonly name: string; readonly value: string }> = []
  for (const [key, value] of Object.entries(command.define)) {
    if (key.startsWith('import.meta.')) {
      if (key.startsWith('import.meta.env.')) {
        processEnvironment.push({ name: key.slice('import.meta.env.'.length), value: JSON.stringify(value) })
      }
      continue
    }
    globals.push({ path: key.split('.'), value })
  }
  for (const [name, value] of Object.entries(command.env)) {
    processEnvironment.push({ name, value: JSON.stringify(value) })
  }
  return { globals, processEnvironment }
}

const splitOf = (command: FixtureCommand): string =>
  Match.value(Result.getOrThrow(planDefine(PlanDefineCommand.make(command)))).pipe(
    Match.tag('NoDefineInjections', () => 'empty'),
    Match.tag('DefineInjections', (injections) =>
      JSON.stringify({
        globals: injections.globals,
        processEnvironment: injections.processEnvironment.map((entry) => ({
          name: entry.name,
          value: JSON.stringify(entry.value),
        })),
      })),
    Match.exhaustive,
  )

describe('planDefine', () => {
  it.prop('∀cmd_DefineInjections_≡VitestDefineSplit', [PlanDefineFixtureSchema], ([command]) => {
    const expected = oracleOf(command)
    if (expected.globals.length === 0 && expected.processEnvironment.length === 0) {
      return splitOf(command) === 'empty'
    }
    return splitOf(command) === JSON.stringify({
      globals: expected.globals,
      processEnvironment: expected.processEnvironment,
    })
  })
})
