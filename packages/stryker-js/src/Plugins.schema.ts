/**
 * Plugins capability — declarations for plugin module shapes and load failures.
 */

import { Schema as S, SchemaGetter } from 'effect'

import type { Framework } from '@systemfsoftware/stryker-framework-interface'
import type { Node } from '@systemfsoftware/stryker-ignorer-interface'
import type { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
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

export const PluginLoadFailureReason = S.Union([
  S.TaggedStruct('PeerMissing', { peer: S.String }),
  S.TaggedStruct('PeerVersionUnsupported', { peer: S.String, detail: S.String }),
  S.TaggedStruct('InvalidContribution', { detail: S.String }),
  S.TaggedStruct('ImportFailed', { cause: S.Unknown }),
])
export type PluginLoadFailureReason = typeof PluginLoadFailureReason.Type

export class PluginNotFoundError extends S.TaggedError<PluginNotFoundError>()(
  'PluginNotFoundError',
  {
    descriptor: S.String,
  },
) {
  readonly exitClass = 'ConfigError' as const
}

const FAILURE_EXIT_CLASS: Record<PluginLoadFailureReason['_tag'], ExitClass> = {
  PeerMissing: 'ConfigError',
  PeerVersionUnsupported: 'ConfigError',
  InvalidContribution: 'ConfigError',
  ImportFailed: 'InternalError',
}

export class PluginLoadRefusedError extends S.TaggedError<PluginLoadRefusedError>()(
  'PluginLoadRefusedError',
  {
    descriptor: S.String,
    reason: PluginLoadFailureReason,
  },
) {
  get exitClass(): ExitClass {
    return FAILURE_EXIT_CLASS[this.reason._tag]
  }

  override get message(): string {
    return `Failed to load plugin "${this.descriptor}" (${this.reason._tag})`
  }
}

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
  reason: S.Literals(['PeerMissing', 'PeerVersionUnsupported']),
  peer: S.String,
  detail: S.String,
})

export const FrameworkContributionSchema = S.Union([FrameworkSchema, FrameworkRefusalSchema])

export const FrameworkModuleSchema = S.Struct({
  strykerFrameworks: S.Array(FrameworkContributionSchema),
})

export type FrameworkModuleContributions = typeof FrameworkModuleSchema.Type['strykerFrameworks']
