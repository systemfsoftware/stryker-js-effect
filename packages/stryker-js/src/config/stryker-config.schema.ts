import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export type StrykerConfig = Options.PartialStrykerOptions

export type Primitive = boolean | number | string | null | undefined

export type ImmutablePrimitive = Primitive | ((...args: never[]) => void)

export type Immutable<T> = T extends ImmutablePrimitive ? T
  : T extends Array<infer U> ? ReadonlyArray<Immutable<U>>
  : T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>>
  : T extends Set<infer M> ? ReadonlySet<Immutable<M>>
  : T extends RegExp ? Readonly<RegExp>
  : { readonly [K in keyof T]: Immutable<T[K]> }

export const ConfigEnvSchema = S.Struct({
  command: S.Literals(['run', 'merge-reports']),
  isDryRun: S.Boolean,
  mode: S.Literals(['human', 'machine']),
  isCi: S.Boolean,
})
export type ConfigEnv = typeof ConfigEnvSchema.Type

export type StrykerConfigFn = (env: ConfigEnv) => StrykerConfig | Promise<StrykerConfig>

export type StrykerConfigExport = StrykerConfig | Promise<StrykerConfig> | StrykerConfigFn
