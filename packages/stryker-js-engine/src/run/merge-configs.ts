import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const asUnknownArray = <A = unknown>(value: A): readonly A[] => Array.isArray(value) ? value : []

const isFirstDescriptorOccurrence =
  <A = unknown>(descriptors: readonly A[]) => (descriptor: A, index: number): boolean =>
    typeof descriptor !== 'string' || descriptors.slice(0, index).includes(descriptor) === false

const mergePluginDescriptors = <A = unknown>(
  parentPlugins: readonly A[],
  childPlugins: readonly A[],
): readonly A[] => {
  const merged = [...parentPlugins, ...childPlugins]
  return merged.filter(isFirstDescriptorOccurrence(merged))
}

const isConfigOptionsRecord = <A = unknown>(value: unknown): value is Record<string, A> =>
  isNonNullObject(value) && Array.isArray(value) === false

const mergeConfigRecords = <A = unknown>(
  parentNested: Record<string, A>,
  childNested: Record<string, A>,
): Record<string, A> => ({ ...parentNested, ...childNested })

const toConfigRecordOption = <A = unknown>(value: A): Option.Option<Record<string, A>> =>
  isConfigOptionsRecord<A>(value) ? Option.some(value) : Option.none()

const inheritNested = <A = unknown>(parentValue: A, childValue: A): A | Record<string, A> =>
  Option.match(Option.all([toConfigRecordOption(parentValue), toConfigRecordOption(childValue)]), {
    onSome: ([parentNested, childNested]) => mergeConfigRecords(parentNested, childNested),
    onNone: () => childValue,
  })

type ConfigOptionValue = Options.PartialStrykerOptions extends Record<string, infer OptionValue> ? OptionValue : never

const inheritEntry = (
  out: Options.PartialStrykerOptions,
  key: string,
  parentValue: ConfigOptionValue,
  childValue: ConfigOptionValue,
): Options.PartialStrykerOptions =>
  Match.value(childValue).pipe(
    Match.when(null, () => {
      const next = { ...out }
      delete next[key]
      return next
    }),
    Match.orElse(() =>
      Match.value(key).pipe(
        Match.when(
          'plugins',
          () => ({
            ...out,
            [key]: mergePluginDescriptors(asUnknownArray(parentValue), asUnknownArray(childValue)),
          }),
        ),
        Match.orElse(() => ({ ...out, [key]: inheritNested(parentValue, childValue) })),
      )
    ),
  )

export const mergeConfigs = dual<
  (child: Options.PartialStrykerOptions) => (parent: Options.PartialStrykerOptions) => Options.PartialStrykerOptions,
  (parent: Options.PartialStrykerOptions, child: Options.PartialStrykerOptions) => Options.PartialStrykerOptions
>(2, (parent, child) =>
  Object.entries(child).reduce(
    (out, entry) => inheritEntry(out, entry[0], parent[entry[0]], entry[1]),
    { ...parent },
  ))
