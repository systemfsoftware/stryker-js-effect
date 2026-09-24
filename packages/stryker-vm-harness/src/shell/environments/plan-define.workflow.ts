import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const DefineInjectionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-vm-harness/DefineInjection',
)
type DefineInjectionTypeId = typeof DefineInjectionTypeId

export class PlanDefineCommand extends S.TaggedClass<PlanDefineCommand>()('PlanDefineCommand', {
  define: S.Record(S.String, S.Json),
  env: S.Record(S.String, S.String),
}) {}

export const GlobalDefineAssignmentSchema = S.Struct({
  path: S.Array(S.String),
  value: S.Json,
})

export type GlobalDefineAssignment = typeof GlobalDefineAssignmentSchema.Type

export const ProcessEnvironmentEntrySchema = S.Struct({
  name: S.String,
  value: S.Json,
})

export type ProcessEnvironmentEntry = typeof ProcessEnvironmentEntrySchema.Type

export class NoDefineInjections extends S.TaggedClass<NoDefineInjections>()('NoDefineInjections', {}) {
  readonly [DefineInjectionTypeId] = DefineInjectionTypeId
}

export class DefineInjections extends S.TaggedClass<DefineInjections>()('DefineInjections', {
  globals: S.Array(GlobalDefineAssignmentSchema),
  processEnvironment: S.Array(ProcessEnvironmentEntrySchema),
}) {
  readonly [DefineInjectionTypeId] = DefineInjectionTypeId
}

export type DefineInjectionPlan = NoDefineInjections | DefineInjections

type DefineTarget = 'globals' | 'processEnvironment' | 'transformOwned'

const targetOf = (key: string): DefineTarget =>
  Match.value(key.startsWith('import.meta.')).pipe(
    Match.when(false, (): DefineTarget => 'globals'),
    Match.when(true, () =>
      Match.value(key.startsWith('import.meta.env.')).pipe(
        Match.when(true, (): DefineTarget => 'processEnvironment'),
        Match.when(false, (): DefineTarget => 'transformOwned'),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const environmentEntryName = (key: string): string => key.slice('import.meta.env.'.length)

const injectionsOf = (command: PlanDefineCommand): DefineInjectionPlan => {
  const globals: Array<GlobalDefineAssignment> = []
  const processEnvironment: Array<ProcessEnvironmentEntry> = []
  for (const [key, value] of Object.entries(command.define)) {
    const target = targetOf(key)
    if (target === 'processEnvironment') {
      processEnvironment.push({ name: environmentEntryName(key), value })
    }
    if (target === 'globals') {
      globals.push({ path: key.split('.'), value })
    }
  }
  for (const [name, value] of Object.entries(command.env)) {
    processEnvironment.push({ name, value })
  }
  return Match.value(globals.length === 0 && processEnvironment.length === 0).pipe(
    Match.when(true, () => NoDefineInjections.make({})),
    Match.when(false, () => DefineInjections.make({ globals, processEnvironment })),
    Match.exhaustive,
  )
}

export const planDefine = Workflow.total(
  PlanDefineCommand,
  (command: PlanDefineCommand) => Result.succeed(injectionsOf(command)),
)
