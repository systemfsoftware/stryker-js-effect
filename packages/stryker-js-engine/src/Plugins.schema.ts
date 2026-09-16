import { Schema as S } from 'effect'

import type { Node } from '@systemfsoftware/stryker-ignorer-interface'

import type { ExitClass } from './exit-classification.schema.js'

export const PluginModuleSchema = S.Struct({
  strykerPlugins: S.Array(S.Unknown),
})

const isShouldIgnore = (value: unknown): value is (node: Node, ancestors: readonly Node[]) => string | undefined =>
  typeof value === 'function'

export const IgnorerEntrySchema = S.Struct({
  name: S.String,
  shouldIgnore: S.declare(isShouldIgnore),
})

export const SchemaValidationContributionSchema = S.Struct({
  strykerValidationSchema: S.Record(S.String, S.Unknown),
})
export const IgnorerModuleSchema = S.Struct({
  strykerIgnorers: S.Array(IgnorerEntrySchema),
})

const isCallableHook = (value: unknown): value is (...args: never[]) => unknown => typeof value === 'function'

export const FrameworkClaimSchema = S.Struct({
  formatId: S.String,
  extensions: S.Array(S.String),
  language: S.String,
  ownerVersion: S.String,
  contractVersion: S.String,
})
export type FrameworkClaim = typeof FrameworkClaimSchema.Type

export const FrameworkServiceSchema = S.Struct({
  claim: FrameworkClaimSchema,
  parse: S.declare(isCallableHook),
  transform: S.declare(isCallableHook),
  print: S.declare(isCallableHook),
  disableTypeChecks: S.declare(isCallableHook),
})

export const PluginDescriptorOutcome = S.Literals(['loaded', 'absent', 'failed', 'undescribed'])
export type PluginDescriptorOutcome = typeof PluginDescriptorOutcome.Type

export const PluginContributionIdentitySchema = S.Struct({
  kind: S.String,
  name: S.String,
})
export type PluginContributionIdentity = typeof PluginContributionIdentitySchema.Type

export class PluginLoadOutcome extends S.TaggedClass<PluginLoadOutcome>()('PluginLoadOutcome', {
  moduleName: S.String,
  outcome: PluginDescriptorOutcome,
  contributions: S.Array(PluginContributionIdentitySchema),
}) {}

export class PluginNameShadowing extends S.TaggedClass<PluginNameShadowing>()('PluginNameShadowing', {
  kind: S.String,
  name: S.String,
  winnerModule: S.String,
  loserModule: S.String,
}) {}

export class PluginExtensionClaimShadowing extends S.TaggedClass<PluginExtensionClaimShadowing>()(
  'PluginExtensionClaimShadowing',
  {
    kind: S.String,
    formatId: S.String,
    extension: S.String,
    winnerModule: S.String,
    loserModule: S.String,
  },
) {}

export type PluginShadowing = PluginNameShadowing | PluginExtensionClaimShadowing

export const PluginLoadFailureReason = S.Union([
  S.TaggedStruct('PeerMissing', { peer: S.String }),
  S.TaggedStruct('PeerVersionUnsupported', { peer: S.String, version: S.String, supportedRange: S.String }),
  S.TaggedStruct('InvalidContribution', { detail: S.String }),
  S.TaggedStruct('ImportFailed', { cause: S.Unknown }),
])
export type PluginLoadFailureReason = typeof PluginLoadFailureReason.Type

const FAILURE_EXIT_CLASS: Record<PluginLoadFailureReason['_tag'], ExitClass> = {
  PeerMissing: 'ConfigError',
  PeerVersionUnsupported: 'ConfigError',
  InvalidContribution: 'ConfigError',
  ImportFailed: 'InternalError',
}

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

export const GeneratedEntrySchema = S.Struct({
  moduleId: S.String,
  contributionName: S.Literals(['alpha', 'beta', 'gamma']),
  extensions: S.Array(S.Literals(['.html', '.vue', '.svelte'])),
})

export const ForeignFrameworkFailureSchema = S.Struct({
  _tag: S.Literal('FrameworkFailed'),
  reason: S.String,
  cause: S.Unknown,
})

export const ForeignFrameworkRefusalSchema = S.Union([
  S.Struct({
    _tag: S.Literal('FrameworkFailed'),
    reason: S.Literal('PeerMissing'),
    peer: S.String,
  }),
  S.Struct({
    _tag: S.Literal('FrameworkFailed'),
    reason: S.Literal('PeerVersionUnsupported'),
    peer: S.String,
    version: S.String,
    supportedRange: S.String,
  }),
])
