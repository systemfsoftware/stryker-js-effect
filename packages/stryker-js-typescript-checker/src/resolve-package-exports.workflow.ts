import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
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

const isJsonObject = (value: JsonValue): value is Record<string, JsonValue> =>
  Boolean.match(typeof value === 'object', {
    onTrue: () => Boolean.and(value !== null, !Array.isArray(value)),
    onFalse: () => false,
  })

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
    onSome: (capture) => target.split('*').join(capture),
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

function resolveTarget(value: JsonValue, star: Option.Option<string>): Option.Option<string> {
  return Option.match(Option.liftPredicate(value, isString), {
    onSome: (target) => Option.some(substituteStar(target, star)),
    onNone: () =>
      Option.match(Option.liftPredicate(value, isJsonArray), {
        onSome: (entries) => Arr.findFirst(entries, (entry) => resolveTarget(entry, star)),
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

const subpathTargetOf = (
  map: Record<string, JsonValue>,
  subpath: string,
): Option.Option<readonly [JsonValue, Option.Option<string>]> =>
  Option.match(Option.fromUndefinedOr(map[subpath]), {
    onSome: (value) => Option.some([value, Option.none<string>()] as const),
    onNone: () =>
      Arr.findFirst(
        Object.entries(map),
        ([key, value]) => Option.map(patternCaptureOf(key, subpath), (star) => [value, Option.some(star)] as const),
      ),
  })

const hasSubpathKeys = (map: Record<string, JsonValue>): boolean =>
  Arr.some(Object.keys(map), (key) => key.startsWith('.'))

const resolveObject = (map: Record<string, JsonValue>, subpath: string): Option.Option<string> =>
  Boolean.match(hasSubpathKeys(map), {
    onTrue: () => Option.flatMap(subpathTargetOf(map, subpath), ([value, star]) => resolveTarget(value, star)),
    onFalse: () =>
      Boolean.match(subpath === '.', {
        onTrue: () => resolveTarget(map, Option.none()),
        onFalse: () => Option.none<string>(),
      }),
  })

const whenRootSubpath = <A>(subpath: string, atRoot: () => Option.Option<A>): Option.Option<A> =>
  Boolean.match(subpath === '.', {
    onTrue: atRoot,
    onFalse: () => Option.none<A>(),
  })

const resolveExports = (exports: JsonValue, subpath: string): Option.Option<string> =>
  Option.match(Option.liftPredicate(exports, isString), {
    onSome: (target) => whenRootSubpath(subpath, () => Option.some(target)),
    onNone: () =>
      Option.match(Option.liftPredicate(exports, isJsonArray), {
        onSome: (entries) =>
          whenRootSubpath(subpath, () => Arr.findFirst(entries, (entry) => resolveTarget(entry, Option.none()))),
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
