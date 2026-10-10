import { OutputMode } from '@systemfsoftware/stryker-js-cli-contract'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { CliCommandSchema } from '../Cli.schema.js'

export type ConfigOverlay = (
  fileOptions: Options.PartialStrykerOptions,
  cliOptions: Options.PartialStrykerOptions,
) => Options.PartialStrykerOptions

export type Primitive = boolean | number | string | null | undefined

export type ImmutablePrimitive = Primitive | ((...args: never[]) => void)

export type Immutable<T> = T extends ImmutablePrimitive ? T
  : T extends Array<infer U> ? ReadonlyArray<Immutable<U>>
  : T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>>
  : T extends Set<infer M> ? ReadonlySet<Immutable<M>>
  : T extends RegExp ? Readonly<RegExp>
  : { readonly [K in keyof T]: Immutable<T[K]> }

export const ConfigEnvSchema = S.Struct({
  command: CliCommandSchema,
  isDryRun: S.Boolean,
  mode: OutputMode.OutputMode,
  isCi: S.Boolean,
})
export type ConfigEnv = typeof ConfigEnvSchema.Type
