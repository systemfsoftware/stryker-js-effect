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
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

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

export const DefineInjectionPlanSchema = S.Union([NoDefineInjections, DefineInjections])

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

const globalAssignmentOf = (
  key: string,
  value: PlanDefineCommand['define'][string],
): ReadonlyArray<GlobalDefineAssignment> =>
  Match.value(targetOf(key)).pipe(
    Match.when('globals', () => [{ path: key.split('.'), value }]),
    Match.when('processEnvironment', (): ReadonlyArray<GlobalDefineAssignment> => []),
    Match.when('transformOwned', (): ReadonlyArray<GlobalDefineAssignment> => []),
    Match.exhaustive,
  )

const environmentEntryOf = (
  key: string,
  value: PlanDefineCommand['define'][string],
): ReadonlyArray<ProcessEnvironmentEntry> =>
  Match.value(targetOf(key)).pipe(
    Match.when('processEnvironment', () => [{ name: environmentEntryName(key), value }]),
    Match.when('globals', (): ReadonlyArray<ProcessEnvironmentEntry> => []),
    Match.when('transformOwned', (): ReadonlyArray<ProcessEnvironmentEntry> => []),
    Match.exhaustive,
  )

const globalsOf = (define: PlanDefineCommand['define']): ReadonlyArray<GlobalDefineAssignment> =>
  Object.entries(define).flatMap(([key, value]) => globalAssignmentOf(key, value))

const defineEnvironmentEntriesOf = (define: PlanDefineCommand['define']): ReadonlyArray<ProcessEnvironmentEntry> =>
  Object.entries(define).flatMap(([key, value]) => environmentEntryOf(key, value))

const envEntriesOf = (env: PlanDefineCommand['env']): ReadonlyArray<ProcessEnvironmentEntry> =>
  Object.entries(env).map(([name, value]) => ({ name, value }))

const isEmptyPlan = (
  globals: ReadonlyArray<GlobalDefineAssignment>,
  processEnvironment: ReadonlyArray<ProcessEnvironmentEntry>,
): boolean =>
  Match.value(globals.length === 0).pipe(
    Match.when(true, () => processEnvironment.length === 0),
    Match.when(false, () => false),
    Match.exhaustive,
  )

const planOf = (
  globals: ReadonlyArray<GlobalDefineAssignment>,
  processEnvironment: ReadonlyArray<ProcessEnvironmentEntry>,
): DefineInjectionPlan =>
  Match.value(isEmptyPlan(globals, processEnvironment)).pipe(
    Match.when(true, () => NoDefineInjections.make({})),
    Match.when(false, () => DefineInjections.make({ globals, processEnvironment })),
    Match.exhaustive,
  )

const injectionsOf = (command: PlanDefineCommand): DefineInjectionPlan =>
  planOf(globalsOf(command.define), [...defineEnvironmentEntriesOf(command.define), ...envEntriesOf(command.env)])

const decide = (command: PlanDefineCommand): Result.Result<DefineInjectionPlan, never> =>
  Result.succeed(injectionsOf(command))

export const planDefine = Workflow.make({
  command: PlanDefineCommand,
  decision: DefineInjectionPlanSchema,
  error: S.Never,
  decide,
})
