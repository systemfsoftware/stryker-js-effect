import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

type JsonValue = S.Schema.Type<typeof S.Json>

const PackageExportsTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-typescript-checker/PackageExports',
)
type PackageExportsTypeId = typeof PackageExportsTypeId

export class ResolvePackageExportsCommand extends S.TaggedClass<ResolvePackageExportsCommand>()(
  'ResolvePackageExportsCommand',
  {
    exports: S.Json,
    subpath: S.String,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class PackageExportsResolved extends S.TaggedClass<PackageExportsResolved>()('PackageExportsResolved', {
  target: S.String,
}) {
  readonly [PackageExportsTypeId] = PackageExportsTypeId
}

export class PackageExportsUnresolved
  extends S.TaggedClass<PackageExportsUnresolved>()('PackageExportsUnresolved', {})
{
  readonly [PackageExportsTypeId] = PackageExportsTypeId
}

export const PackageExportsResolution = S.Union([PackageExportsResolved, PackageExportsUnresolved])
export type PackageExportsResolution = typeof PackageExportsResolution.Type

const ACTIVE_CONDITIONS: ReadonlyArray<string> = ['require', 'types', 'node', 'default']

const isString = (value: JsonValue): value is string => typeof value === 'string'

const isJsonArray = (value: JsonValue): value is ReadonlyArray<JsonValue> => Array.isArray(value)

const isJsonObject = (value: JsonValue): value is Record<string, JsonValue> => Predicate.isObject(value)

const isActiveCondition = (key: string): boolean => ACTIVE_CONDITIONS.includes(key)

const starPartsOf = (key: string): Option.Option<readonly [string, string]> => {
  const parts = key.split('*')
  return Option.map(
    Option.filter(Option.all([Arr.head(parts), Arr.get(parts, 1)]), () => parts.length === 2),
    ([prefix, suffix]) => [prefix, suffix] as const,
  )
}

const substituteStar = (target: string, star: Option.Option<string>): string =>
  Option.match(star, {
    onNone: () => target,
    onSome: (capture) => target.replaceAll('*', capture),
  })

const resolveConditional = (
  conditions: Record<string, JsonValue>,
  star: Option.Option<string>,
): Option.Option<string> =>
  Arr.findFirst(
    Object.entries(conditions),
    ([key, entry]) =>
      Boolean.match(isActiveCondition(key), {
        onTrue: () => resolveTarget(entry, star),
        onFalse: () => Option.none<string>(),
      }),
  )

const INVALID_TARGET_SEGMENTS: ReadonlyArray<string> = ['.', '..', 'node_modules']

const hasInvalidTargetSegment = (target: string): boolean =>
  Arr.some(target.split('/').slice(1), (segment) => INVALID_TARGET_SEGMENTS.includes(segment))

const isResolvableTarget = (target: string): boolean =>
  Boolean.and(target.startsWith('./'), Boolean.not(hasInvalidTargetSegment(target)))

const resolveArrayTarget = (
  entries: ReadonlyArray<JsonValue>,
  star: Option.Option<string>,
): Option.Option<string> =>
  Option.match(Arr.head(entries), {
    onNone: () => Option.none<string>(),
    onSome: (entry) =>
      Boolean.match(entry === null, {
        onTrue: () => Option.none<string>(),
        onFalse: () =>
          Option.match(resolveTarget(entry, star), {
            onSome: (target) => Option.some(target),
            onNone: () => resolveArrayTarget(Arr.drop(entries, 1), star),
          }),
      }),
  })

function resolveTarget(value: JsonValue, star: Option.Option<string>): Option.Option<string> {
  return Option.match(Option.liftPredicate(value, isString), {
    onSome: (target) => Option.liftPredicate(substituteStar(target, star), isResolvableTarget),
    onNone: () =>
      Option.match(Option.liftPredicate(value, isJsonArray), {
        onSome: (entries) => resolveArrayTarget(entries, star),
        onNone: () =>
          Option.match(Option.liftPredicate(value, isJsonObject), {
            onSome: (conditions) => resolveConditional(conditions, star),
            onNone: () => Option.none<string>(),
          }),
      }),
  })
}

const patternCaptureOf = (key: string, subpath: string): Option.Option<string> =>
  Option.flatMap(starPartsOf(key), ([prefix, suffix]) =>
    Option.map(
      Option.liftPredicate(
        subpath,
        (candidate) =>
          Boolean.and(
            Boolean.and(candidate.startsWith(prefix), candidate.endsWith(suffix)),
            candidate.length >= prefix.length + suffix.length,
          ),
      ),
      (candidate) => candidate.slice(prefix.length, candidate.length - suffix.length),
    ))

const patternKeyBaseLengthOf = (key: string): number =>
  Boolean.match(key.indexOf('*') === -1, {
    onTrue: () => key.length,
    onFalse: () => key.indexOf('*') + 1,
  })

const comparePatternKeysOf = (left: string, right: string): number =>
  Boolean.match(patternKeyBaseLengthOf(left) === patternKeyBaseLengthOf(right), {
    onTrue: () => right.length - left.length,
    onFalse: () => patternKeyBaseLengthOf(right) - patternKeyBaseLengthOf(left),
  })

const bestPatternMatchOf = (
  map: Record<string, JsonValue>,
  subpath: string,
): Option.Option<readonly [JsonValue, string]> =>
  Option.map(
    Arr.reduce(
      Object.entries(map),
      Option.none<readonly [string, JsonValue, string]>(),
      (best, [key, value]) =>
        Option.match(patternCaptureOf(key, subpath), {
          onNone: () => best,
          onSome: (star) =>
            Option.match(best, {
              onNone: () => Option.some([key, value, star] as const),
              onSome: (current) =>
                Boolean.match(comparePatternKeysOf(key, current[0]) < 0, {
                  onTrue: () => Option.some([key, value, star] as const),
                  onFalse: () => best,
                }),
            }),
        }),
    ),
    ([, value, star]) => [value, star] as const,
  )

const subpathTargetOf = (
  map: Record<string, JsonValue>,
  subpath: string,
): Option.Option<readonly [JsonValue, Option.Option<string>]> =>
  Option.match(Option.fromUndefinedOr(map[subpath]), {
    onSome: (value) => Option.some([value, Option.none<string>()] as const),
    onNone: () => Option.map(bestPatternMatchOf(map, subpath), ([value, star]) => [value, Option.some(star)] as const),
  })

const hasSubpathKeys = (map: Record<string, JsonValue>): boolean =>
  Arr.some(Object.keys(map), (key) => key.startsWith('.'))

const whenRootSubpath = <A>(subpath: string, atRoot: () => Option.Option<A>): Option.Option<A> =>
  Boolean.match(subpath === '.', {
    onTrue: atRoot,
    onFalse: () => Option.none<A>(),
  })

const resolveObject = (map: Record<string, JsonValue>, subpath: string): Option.Option<string> =>
  Boolean.match(hasSubpathKeys(map), {
    onTrue: () => Option.flatMap(subpathTargetOf(map, subpath), ([value, star]) => resolveTarget(value, star)),
    onFalse: () => whenRootSubpath(subpath, () => resolveTarget(map, Option.none())),
  })

const resolveExports = (exports: JsonValue, subpath: string): Option.Option<string> =>
  Option.match(Option.liftPredicate(exports, isString), {
    onSome: (target) => whenRootSubpath(subpath, () => resolveTarget(target, Option.none())),
    onNone: () =>
      Option.match(Option.liftPredicate(exports, isJsonArray), {
        onSome: (entries) => whenRootSubpath(subpath, () => resolveArrayTarget(entries, Option.none())),
        onNone: () =>
          Option.match(Option.liftPredicate(exports, isJsonObject), {
            onSome: (map) => resolveObject(map, subpath),
            onNone: () => Option.none<string>(),
          }),
      }),
  })

const decide = (command: ResolvePackageExportsCommand): Result.Result<PackageExportsResolution, never> =>
  Result.succeed(
    Option.match(resolveExports(command.exports, command.subpath), {
      onNone: () => PackageExportsUnresolved.make({}),
      onSome: (target) => PackageExportsResolved.make({ target }),
    }),
  )

export const resolvePackageExports = Workflow.make({
  command: ResolvePackageExportsCommand,
  decision: PackageExportsResolution,
  error: S.Never,
  decide,
})
