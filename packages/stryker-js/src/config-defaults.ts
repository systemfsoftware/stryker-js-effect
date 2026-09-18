import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

export type Primitive = boolean | number | string | null | undefined

type ImmutablePrimitive = Primitive | ((...args: never[]) => unknown)

export type Immutable<T> = T extends ImmutablePrimitive ? T
  : T extends Array<infer U> ? ReadonlyArray<Immutable<U>>
  : T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>>
  : T extends Set<infer M> ? ReadonlySet<Immutable<M>>
  : T extends RegExp ? Readonly<RegExp>
  : { readonly [K in keyof T]: Immutable<T[K]> }

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isArrayValue = (value: unknown): value is readonly unknown[] => Array.isArray(value)

const freezeArrayValue = (value: readonly unknown[]): unknown => Object.freeze(value.map(deepFreeze))

const freezeMapEntry = (
  [entryKey, entryValue]: readonly [unknown, unknown],
): [unknown, unknown] => [deepFreeze(entryKey), deepFreeze(entryValue)]

const freezeMapValue = (value: Map<unknown, unknown>): unknown =>
  Object.freeze(new Map([...value.entries()].map(freezeMapEntry)))

const freezeSetValue = (value: Set<unknown>): unknown => Object.freeze(new Set([...value.values()].map(deepFreeze)))

const freezeRegExpValue = (value: RegExp): unknown => Object.freeze(value)

const freezeRecordValue = (value: object): unknown =>
  Object.freeze(
    Object.entries(value).reduce<Record<string, unknown>>((frozen, [property, propertyValue]) => {
      frozen[property] = deepFreeze(propertyValue)
      return frozen
    }, {}),
  )

export function deepFreeze<T>(target: T): Immutable<T>
export function deepFreeze(target: unknown): unknown {
  return Match.value(target).pipe(
    Match.when(isArrayValue, freezeArrayValue),
    Match.when((value: unknown): value is Map<unknown, unknown> => value instanceof Map, freezeMapValue),
    Match.when((value: unknown): value is RegExp => value instanceof RegExp, freezeRegExpValue),
    Match.when((value: unknown): value is Set<unknown> => value instanceof Set, freezeSetValue),
    Match.when(isNonNullObject, freezeRecordValue),
    Match.orElse(() => target),
  )
}

export const optionsPath = (...path: string[]): string => path.join('.')
const SUPPORTED_CONFIG_FILE_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.js', '.mjs']

const configFileNames = (extensions: readonly string[]): readonly string[] =>
  extensions.map((extension) => `stryker.config${extension}`)

export const SUPPORTED_CONFIG_FILE_NAMES = Object.freeze(configFileNames(SUPPORTED_CONFIG_FILE_EXTENSIONS))

const RELATIVE_SPECIFIER_PREFIXES: readonly string[] = ['/', './', '../', 'file://']

export function isModuleSpecifier(value: string): boolean {
  return RELATIVE_SPECIFIER_PREFIXES.every((prefix) => value.startsWith(prefix) === false)
}

export const CONFIG_SYNTAX_HELP = `
Example of how a config file should look:
/**
  * @type {import('@systemfsoftware/stryker-js-plugin-interface').StrykerOptions}
  */
export default {
  mutate: ['src/**/*.js'],
  testRunner: 'vitest',
  reporters: ['progress', 'clear-text', 'html'],
  concurrency: 4
};
See https://stryker-mutator.io/docs/stryker-js/config-file for more information.`.trim()

export const createDefaultOptions: Effect.Effect<StrykerOptions> = S.decodeEffect(StrykerOptionsSchema)({}).pipe(
  Effect.orDie,
)

export const defaultOptions: Effect.Effect<Immutable<StrykerOptions>, never, never> = Effect.map(
  createDefaultOptions,
  (opts) => deepFreeze(opts),
)

export interface UnserializableDescription {
  path: string[]
  reason: string
}

const scopedUnserializable =
  (scope: string) => (description: UnserializableDescription): UnserializableDescription => ({
    ...description,
    path: [scope, ...description.path],
  })

const describeUnserializableChild = (
  child: unknown,
  scope: string,
): UnserializableDescription[] =>
  Match.value(findUnserializables(child)).pipe(
    Match.when(undefined, (): UnserializableDescription[] => []),
    Match.orElse((descriptions) => descriptions.map(scopedUnserializable(scope))),
  )

const collectUnserializables = (
  groups: readonly (readonly UnserializableDescription[])[],
): UnserializableDescription[] | undefined => {
  const found = groups.flat()
  if (found.length > 0) return found
  return undefined
}

const describeUnserializableArray = (
  value: readonly unknown[],
): UnserializableDescription[] | undefined =>
  collectUnserializables(
    value.map((child, index) => describeUnserializableChild(child, index.toString())),
  )

const describeUnserializableRecord = (
  value: object,
): UnserializableDescription[] | undefined =>
  collectUnserializables(
    Object.entries(value).map(([key, child]) => describeUnserializableChild(child, key)),
  )

const isPlainObjectValue = (value: object): boolean => !Array.isArray(value) && value.constructor === Object

const classNameOf = (value: object): string =>
  Match.value(value.constructor).pipe(
    Match.when(Match.defined, (ctor) => ctor.name),
    Match.orElse(() => 'Object'),
  )

const describeUnserializableInstance = (
  value: object,
): UnserializableDescription[] | undefined => [
  {
    path: [],
    reason: `Value is an instance of "${
      classNameOf(value)
    }", this detail will get lost in translation during serialization`,
  },
]

const describeUnserializableObject = (
  value: object,
): UnserializableDescription[] | undefined =>
  Match.value(value).pipe(
    Match.when(isArrayValue, describeUnserializableArray),
    Match.when(isPlainObjectValue, describeUnserializableRecord),
    Match.orElse(describeUnserializableInstance),
  )

const NON_JSON_PRIMITIVE_TYPES: readonly string[] = ['bigint', 'function', 'symbol']

const isNonJsonPrimitive = (
  value: unknown,
): value is bigint | symbol | ((...args: never[]) => unknown) => NON_JSON_PRIMITIVE_TYPES.includes(typeof value)

const describeNonJsonPrimitive = (
  value: bigint | symbol | ((...args: never[]) => unknown),
): UnserializableDescription[] | undefined => [
  {
    path: [],
    reason: `Primitive type "${typeof value}" has no JSON representation`,
  },
]

const describeNumber = (value: number): UnserializableDescription[] | undefined => {
  if (isFinite(value)) return undefined
  return [
    {
      reason: `Number value \`${value}\` has no JSON representation`,
      path: [],
    },
  ]
}

export function findUnserializables(
  thing: unknown,
): UnserializableDescription[] | undefined {
  return Match.value(thing).pipe(
    Match.when((value: unknown): value is number => typeof value === 'number', describeNumber),
    Match.when(isNonJsonPrimitive, describeNonJsonPrimitive),
    Match.when(isNonNullObject, describeUnserializableObject),
    Match.orElse(() => undefined),
  )
}

type KnownKeys<T> = keyof {
  [P in keyof T as string extends P ? never : number extends P ? never : P]: T[P]
}

export type WarningOptions = Exclude<StrykerOptions['warnings'], boolean>

export function isWarningEnabled(
  warningType: KnownKeys<WarningOptions>,
  warningOptions: WarningOptions | boolean,
): boolean {
  if (typeof warningOptions === 'boolean') {
    return warningOptions
  } else {
    return warningOptions[warningType] === true
  }
}
