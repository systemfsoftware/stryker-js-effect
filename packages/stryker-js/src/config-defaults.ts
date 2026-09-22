import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

export type Primitive = boolean | number | string | null | undefined

export type ImmutablePrimitive = Primitive | ((...args: never[]) => void)

export type Immutable<T> = T extends ImmutablePrimitive ? T
  : T extends Array<infer U> ? ReadonlyArray<Immutable<U>>
  : T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>>
  : T extends Set<infer M> ? ReadonlySet<Immutable<M>>
  : T extends RegExp ? Readonly<RegExp>
  : { readonly [K in keyof T]: Immutable<T[K]> }

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isRecordValue = <A = unknown>(value: unknown): value is Record<string, A> =>
  isNonNullObject(value) && Array.isArray(value) === false

const isArrayValue = <A = unknown>(value: unknown): value is readonly A[] => Array.isArray(value)

const freezeArrayValue = <A = unknown>(value: readonly A[]): ReadonlyArray<Immutable<A>> =>
  Object.freeze(value.map((element) => deepFreeze(element)))

const freezeMapEntry = <K = unknown, V = unknown>(
  [entryKey, entryValue]: readonly [K, V],
): readonly [Immutable<K>, Immutable<V>] => [deepFreeze(entryKey), deepFreeze(entryValue)]

const freezeMapValue = <K = unknown, V = unknown>(value: Map<K, V>): ReadonlyMap<Immutable<K>, Immutable<V>> =>
  Object.freeze(new Map([...value.entries()].map(freezeMapEntry)))

const freezeSetValue = <A = unknown>(value: Set<A>): ReadonlySet<Immutable<A>> =>
  Object.freeze(new Set([...value.values()].map((element) => deepFreeze(element))))

const freezeRegExpValue = (value: RegExp): RegExp => Object.freeze(value)

const freezeRecordValue = <A = unknown>(value: Record<string, A>): Record<string, Immutable<A>> =>
  Object.freeze(
    Object.entries(value).reduce<Record<string, Immutable<A>>>((frozen, [property, propertyValue]) => {
      frozen[property] = deepFreeze(propertyValue)
      return frozen
    }, {}),
  )

export function deepFreeze<T>(target: T): Immutable<T>
export function deepFreeze(target: object | Primitive): object | Primitive {
  return Match.value(target).pipe(
    Match.when(isArrayValue, freezeArrayValue),
    Match.when(
      <K = unknown, V = unknown>(value: unknown): value is Map<K, V> => value instanceof Map,
      freezeMapValue,
    ),
    Match.when((value: unknown): value is RegExp => value instanceof RegExp, freezeRegExpValue),
    Match.when(
      <A2 = unknown>(value: unknown): value is Set<A2> => value instanceof Set,
      freezeSetValue,
    ),
    Match.when(isRecordValue, freezeRecordValue),
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

const describeUnserializableChild = <A = unknown>(
  child: A,
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

const describeUnserializableArray = <A = unknown>(
  value: readonly A[],
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
): value is bigint | symbol | ((...args: never[]) => void) => NON_JSON_PRIMITIVE_TYPES.includes(typeof value)

const describeNonJsonPrimitive = (
  value: bigint | symbol | ((...args: never[]) => void),
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

export function findUnserializables<A = unknown>(
  thing: A,
): UnserializableDescription[] | undefined {
  if (typeof thing === 'number') {
    return describeNumber(thing)
  }
  return describeNonNumberValue(thing)
}

function describeNonNumberValue<A = unknown>(
  thing: A,
): UnserializableDescription[] | undefined {
  return isNonJsonPrimitive(thing) ? describeNonJsonPrimitive(thing) : describeObjectValue(thing)
}

function describeObjectValue<A = unknown>(
  thing: A,
): UnserializableDescription[] | undefined {
  return isNonNullObject(thing) ? describeUnserializableObject(thing) : undefined
}

export type KnownKeys<T> = keyof {
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
