import { Schema as S, SchemaGetter } from 'effect'
import * as HashMap from 'effect/HashMap'

import type { Framework } from '@systemfsoftware/stryker-framework-interface'
import type { Ignorer as IgnorerDescriptor, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'

import { PeerFailureTag } from './PluginsError.schema.js'

export const PluginDescriptorSchema = S.Union([
  S.Struct({ kind: Plugin.WorkerPluginKind, name: S.String, workerEntry: Plugin.WorkerEntryUrl }),
  S.Struct({ kind: Plugin.EvaluatorPluginKind, name: S.String }),
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

const NOOP_PARSE: Framework['parse'] = () => ({ kind: 'ParseFailed', message: 'no framework hook' })
const NOOP_TRANSFORM: Framework['transform'] = (document) => document
const NOOP_PRINT: Framework['print'] = () => ''
const NOOP_DISABLE_TYPE_CHECKS: Framework['disableTypeChecks'] = (rawContent) => ({
  kind: 'Parsed',
  value: rawContent,
})

const parseHookArbitrary = S.link<Framework['parse']>()(S.Null, {
  decode: SchemaGetter.transform(() => NOOP_PARSE),
  encode: SchemaGetter.transform(() => null),
})
const ParseHookSchema = S.declare<Framework['parse']>(
  (value: unknown): value is Framework['parse'] => typeof value === 'function',
  { toCodecArbitrary: () => parseHookArbitrary },
)

const transformHookArbitrary = S.link<Framework['transform']>()(S.Null, {
  decode: SchemaGetter.transform(() => NOOP_TRANSFORM),
  encode: SchemaGetter.transform(() => null),
})
const TransformHookSchema = S.declare<Framework['transform']>(
  (value: unknown): value is Framework['transform'] => typeof value === 'function',
  { toCodecArbitrary: () => transformHookArbitrary },
)

const printHookArbitrary = S.link<Framework['print']>()(S.Null, {
  decode: SchemaGetter.transform(() => NOOP_PRINT),
  encode: SchemaGetter.transform(() => null),
})
const PrintHookSchema = S.declare<Framework['print']>(
  (value: unknown): value is Framework['print'] => typeof value === 'function',
  { toCodecArbitrary: () => printHookArbitrary },
)

const disableTypeChecksHookArbitrary = S.link<Framework['disableTypeChecks']>()(S.Null, {
  decode: SchemaGetter.transform(() => NOOP_DISABLE_TYPE_CHECKS),
  encode: SchemaGetter.transform(() => null),
})
const DisableTypeChecksHookSchema = S.declare<Framework['disableTypeChecks']>(
  (value: unknown): value is Framework['disableTypeChecks'] => typeof value === 'function',
  { toCodecArbitrary: () => disableTypeChecksHookArbitrary },
)

export const FrameworkClaimSchema = S.Struct({
  formatId: S.String,
  extensions: S.Array(S.String),
  language: S.String,
  ownerVersion: S.String,
  contractVersion: S.Literal('1'),
})

export const FrameworkSchema = S.Struct({
  kind: S.Literal('Framework'),
  name: S.String,
  claim: FrameworkClaimSchema,
  parse: ParseHookSchema,
  transform: TransformHookSchema,
  print: PrintHookSchema,
  disableTypeChecks: DisableTypeChecksHookSchema,
})

export const FrameworkRefusalSchema = S.Struct({
  kind: S.Literal('FrameworkRefusal'),
  name: S.String,
  reason: PeerFailureTag,
  peer: S.String,
  detail: S.String,
})

export const FrameworkContributionSchema = S.Union([FrameworkSchema, FrameworkRefusalSchema])

export const FrameworkModuleSchema = S.Struct({
  strykerFrameworks: S.Array(FrameworkContributionSchema),
})

export type FrameworkModuleContributions = typeof FrameworkModuleSchema.Type['strykerFrameworks']

export const FrameworkManifestSchema = S.Struct({
  strykerFramework: S.Struct({ extensions: S.Array(S.String) }),
})

export const ProjectDependencies = S.Struct({
  dependencies: S.optional(S.Record(S.String, S.Unknown)),
  devDependencies: S.optional(S.Record(S.String, S.Unknown)),
})

export const PluginSourceSchema = S.Union([
  S.Struct({ kind: Plugin.WorkerPluginKind, name: S.String, modulePath: S.String, workerEntry: S.String }),
  S.Struct({ kind: Plugin.EvaluatorPluginKind, name: S.String, modulePath: S.String }),
])

export type PluginKind = Plugin.PluginKind

export interface WorkerPluginDescriptor<K extends Plugin.WorkerPluginKind = Plugin.WorkerPluginKind> {
  readonly kind: K
  readonly name: string
  readonly workerEntry: string
}

export interface EvaluatorPluginDescriptor {
  readonly kind: 'Evaluator'
  readonly name: string
}

export type AnyWorkerPluginDescriptor = {
  [K in Plugin.WorkerPluginKind]: WorkerPluginDescriptor<K>
}[Plugin.WorkerPluginKind]

export type AnyPluginDescriptor = AnyWorkerPluginDescriptor | EvaluatorPluginDescriptor

export type PluginDescriptorOf<K extends PluginKind> = Extract<AnyPluginDescriptor, { readonly kind: K }>

export type PluginDescriptor<K extends PluginKind = PluginKind> = PluginDescriptorOf<K>

export interface WorkerPluginSource<K extends Plugin.WorkerPluginKind = Plugin.WorkerPluginKind> {
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
  [K in Plugin.WorkerPluginKind]: WorkerPluginSource<K>
}[Plugin.WorkerPluginKind]

export type PluginSource = AnyWorkerPluginSource | EvaluatorPluginSource

export interface LoadedPlugins<A = unknown> {
  readonly schemaContributions: readonly Record<string, A>[]
  readonly pluginsByKind: HashMap.HashMap<PluginKind, readonly PluginDescriptor[]>
  readonly pluginModulePaths: readonly string[]
  readonly pluginSources: readonly PluginSource[]
  readonly ignorers: readonly IgnorerDescriptor[]
  readonly frameworks: readonly {
    readonly moduleName: string
    readonly framework: Framework
  }[]
}
