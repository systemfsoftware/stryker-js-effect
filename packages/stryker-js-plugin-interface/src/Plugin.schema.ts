import type { ReporterFactory } from '@systemfsoftware/stryker-js-language'

import * as S from 'effect/Schema'

import type * as Layer from 'effect/Layer'

import type { PluginEnvironment, PluginInterfaces } from './Plugin.js'

export const PluginKind = S.Literals(['Checker', 'TestRunner', 'Reporter', 'Ignore', 'Evaluator', 'Framework'])
export type PluginKind = typeof PluginKind.Type

export const PluginLayerKind = S.Literals(['Checker', 'TestRunner', 'Ignore', 'Evaluator', 'Framework'])
export type PluginLayerKind = typeof PluginLayerKind.Type

export class PluginLayerContribution<K extends PluginLayerKind = PluginLayerKind>
  extends S.TaggedClass<PluginLayerContribution<PluginLayerKind>>()('PluginContribution', {
    kind: PluginLayerKind,
    name: S.String,
    layer: S.Unknown,
  })
{
  declare readonly kind: K
  declare readonly name: string
  declare readonly layer: Layer.Layer<PluginInterfaces[K], never, PluginEnvironment>
}

export class PluginReporterContribution extends S.TaggedClass<PluginReporterContribution>()('PluginContribution', {
  kind: PluginKind,
  name: S.String,
  make: S.Unknown,
}) {
  declare readonly kind: 'Reporter'
  declare readonly name: string
  declare readonly make: ReporterFactory
}

export type PluginContribution<K extends PluginKind = PluginKind> = K extends 'Reporter' ? PluginReporterContribution
  : PluginLayerContribution<Extract<K, PluginLayerKind>>
