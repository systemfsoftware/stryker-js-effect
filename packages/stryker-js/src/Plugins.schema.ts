/**
 * Plugins capability — declarations for plugin module shapes and load failures.
 */

import { Schema as S, SchemaGetter } from 'effect'
import * as HashMap from 'effect/HashMap'

import type { Ignorer as IgnorerDescriptor, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { WorkerEntryUrl, WorkerPluginKind } from '@systemfsoftware/stryker-js-plugin-interface'

export const PluginDescriptorSchema = S.Union([
  S.Struct({ kind: WorkerPluginKind, name: S.String, workerEntry: WorkerEntryUrl }),
  S.Struct({ kind: S.Literals(['Evaluator']), name: S.String }),
])

export const PluginModuleSchema = S.Struct({
  strykerPlugins: S.Array(PluginDescriptorSchema),
})

type ShouldIgnore = (node: Node, ancestors: readonly Node[]) => string | undefined

const isShouldIgnore = (value: unknown): value is ShouldIgnore => typeof value === 'function'

const ignoreNothing: ShouldIgnore = () => undefined

const shouldIgnoreArbitrary = S.link<ShouldIgnore>()(S.Null, {
  decode: SchemaGetter.transform(() => ignoreNothing),
  encode: SchemaGetter.transform(() => null),
})

export const IgnorerEntrySchema = S.Struct({
  name: S.String,
  shouldIgnore: S.declare<ShouldIgnore>(isShouldIgnore, { toCodecArbitrary: () => shouldIgnoreArbitrary }),
})

export const IgnorerModuleSchema = S.Struct({
  strykerIgnorers: S.Array(IgnorerEntrySchema),
})

export const SchemaValidationContributionSchema = S.Struct({
  strykerValidationSchema: S.Record(S.String, S.Unknown),
})

export class PluginNotFoundError extends S.TaggedError<PluginNotFoundError>()(
  'PluginNotFoundError',
  {
    descriptor: S.String,
  },
) {
  readonly exitClass = 'ConfigError' as const
}

export class PluginLoadFailedError extends S.TaggedError<PluginLoadFailedError>()(
  'PluginLoadFailedError',
  {
    descriptor: S.String,
    cause: S.Unknown,
  },
) {
  readonly exitClass = 'InternalError' as const
}

export const PluginSourceSchema = S.Union([
  S.Struct({ kind: WorkerPluginKind, name: S.String, modulePath: S.String, workerEntry: S.String }),
  S.Struct({ kind: S.Literals(['Evaluator']), name: S.String, modulePath: S.String }),
])

export type PluginKind = WorkerPluginKind | 'Evaluator'

export interface WorkerPluginDescriptor<K extends WorkerPluginKind = WorkerPluginKind> {
  readonly kind: K
  readonly name: string
  readonly workerEntry: string
}

export interface EvaluatorPluginDescriptor {
  readonly kind: 'Evaluator'
  readonly name: string
}

export type AnyWorkerPluginDescriptor = {
  [K in WorkerPluginKind]: WorkerPluginDescriptor<K>
}[WorkerPluginKind]

export type AnyPluginDescriptor = AnyWorkerPluginDescriptor | EvaluatorPluginDescriptor

export type PluginDescriptorOf<K extends PluginKind> = Extract<AnyPluginDescriptor, { readonly kind: K }>

export type PluginDescriptor<K extends PluginKind = PluginKind> = PluginDescriptorOf<K>

export interface WorkerPluginSource<K extends WorkerPluginKind = WorkerPluginKind> {
  readonly kind: K
  readonly name: string
  readonly modulePath: string
  readonly workerEntry: string
}

export interface EvaluatorPluginSource {
  readonly kind: 'Evaluator'
  readonly name: string
  readonly modulePath: string
}

export type AnyWorkerPluginSource = {
  [K in WorkerPluginKind]: WorkerPluginSource<K>
}[WorkerPluginKind]

export type PluginSource = AnyWorkerPluginSource | EvaluatorPluginSource

export interface LoadedPlugins<A = unknown> {
  readonly schemaContributions: readonly Record<string, A>[]
  readonly pluginsByKind: HashMap.HashMap<PluginKind, readonly PluginDescriptor[]>
  readonly pluginModulePaths: readonly string[]
  readonly pluginSources: readonly PluginSource[]
  readonly ignorers: readonly IgnorerDescriptor[]
}
