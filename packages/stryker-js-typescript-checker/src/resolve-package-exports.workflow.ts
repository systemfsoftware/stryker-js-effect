import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
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
  targets: S.Array(S.String),
  terminal: S.Boolean,
}) {
  readonly [PackageExportsTypeId] = PackageExportsTypeId
}

export class PackageExportsExcluded extends S.TaggedClass<PackageExportsExcluded>()('PackageExportsExcluded', {}) {
  readonly [PackageExportsTypeId] = PackageExportsTypeId
}

export class PackageExportsUnresolved
  extends S.TaggedClass<PackageExportsUnresolved>()('PackageExportsUnresolved', {})
{
  readonly [PackageExportsTypeId] = PackageExportsTypeId
}

export const PackageExportsResolution = S.Union([
  PackageExportsResolved,
  PackageExportsExcluded,
  PackageExportsUnresolved,
])
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

const TargetsResolved = S.TaggedStruct('TargetsResolved', { targets: S.Array(S.String), terminated: S.Boolean })

const SubpathExcluded = S.TaggedStruct('SubpathExcluded', {})

const TryNextEntry = S.TaggedStruct('TryNextEntry', {})

const TargetStep = S.Union([TargetsResolved, SubpathExcluded, TryNextEntry])
type TargetStep = typeof TargetStep.Type

const targetsResolved = (targets: ReadonlyArray<string>, terminated: boolean): TargetStep =>
  TargetsResolved.make({ targets, terminated })

const SUBPATH_EXCLUDED: TargetStep = SubpathExcluded.make({})

const TRY_NEXT_ENTRY: TargetStep = TryNextEntry.make({})

const resolutionOf = (step: TargetStep): PackageExportsResolution =>
  Match.value(step).pipe(
    Match.tag('TargetsResolved', ({ targets, terminated }) =>
      PackageExportsResolved.make({ targets, terminal: terminated })),
    Match.tag('SubpathExcluded', () =>
      PackageExportsExcluded.make({})),
    Match.tag('TryNextEntry', () => PackageExportsUnresolved.make({})),
    Match.exhaustive,
  )

const firstDecidedStepOf = <A>(entries: ReadonlyArray<A>, stepOf: (entry: A) => TargetStep): TargetStep =>
  Option.match(Arr.head(entries), {
    onNone: () => TRY_NEXT_ENTRY,
    onSome: (entry) =>
      Match.value(stepOf(entry)).pipe(
        Match.tag('TargetsResolved', (resolved): TargetStep => resolved),
        Match.tag('SubpathExcluded', (excluded): TargetStep => excluded),
        Match.tag('TryNextEntry', () => firstDecidedStepOf(Arr.drop(entries, 1), stepOf)),
        Match.exhaustive,
      ),
  })

const appendTargets = (
  entries: ReadonlyArray<JsonValue>,
  star: Option.Option<string>,
  accumulated: ReadonlyArray<string>,
): TargetStep =>
  Option.match(Arr.head(entries), {
    onNone: () =>
      Boolean.match(accumulated.length === 0, {
        onTrue: () => TRY_NEXT_ENTRY,
        onFalse: () => targetsResolved(accumulated, false),
      }),
    onSome: (entry) =>
      Match.value(resolveTarget(entry, star)).pipe(
        Match.tag('TargetsResolved', ({ targets, terminated }) =>
          Boolean.match(terminated, {
            onTrue: () => targetsResolved([...accumulated, ...targets], true),
            onFalse: () => appendTargets(Arr.drop(entries, 1), star, [...accumulated, ...targets]),
          })),
        Match.tag('SubpathExcluded', (excluded): TargetStep =>
          Boolean.match(accumulated.length === 0, {
            onTrue: () => excluded,
            onFalse: () => targetsResolved(accumulated, true),
          })),
        Match.tag('TryNextEntry', () => appendTargets(Arr.drop(entries, 1), star, accumulated)),
        Match.exhaustive,
      ),
  })

const resolveConditional = (conditions: Record<string, JsonValue>, star: Option.Option<string>): TargetStep =>
  firstDecidedStepOf(
    Arr.filter(Object.entries(conditions), ([key]) => isActiveCondition(key)),
    ([, entry]) => resolveTarget(entry, star),
  )

const INVALID_TARGET_SEGMENTS: ReadonlyArray<string> = ['.', '..', 'node_modules']

const hasInvalidTargetSegment = (target: string): boolean =>
  Arr.some(target.split('/').slice(1), (segment) => INVALID_TARGET_SEGMENTS.includes(segment))

const isResolvableTarget = (target: string): boolean =>
  Boolean.and(target.startsWith('./'), Boolean.not(hasInvalidTargetSegment(target)))

const resolveStringTarget = (target: string): TargetStep =>
  Boolean.match(isResolvableTarget(target), {
    onTrue: () => targetsResolved([target], false),
    onFalse: () => TRY_NEXT_ENTRY,
  })

function resolveTarget(value: JsonValue, star: Option.Option<string>): TargetStep {
  return Boolean.match(value === null, {
    onTrue: () => SUBPATH_EXCLUDED,
    onFalse: () =>
      Option.match(Option.liftPredicate(value, isString), {
        onSome: (target) => resolveStringTarget(substituteStar(target, star)),
        onNone: () =>
          Option.match(Option.liftPredicate(value, isJsonArray), {
            onSome: (entries) => appendTargets(entries, star, []),
            onNone: () =>
              Option.match(Option.liftPredicate(value, isJsonObject), {
                onSome: (conditions) => resolveConditional(conditions, star),
                onNone: () => TRY_NEXT_ENTRY,
              }),
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

const resolveExports = (exports: JsonValue, subpath: string): Option.Option<TargetStep> =>
  Option.match(Option.filter(Option.liftPredicate(exports, isJsonObject), hasSubpathKeys), {
    onSome: (map) => Option.map(subpathTargetOf(map, subpath), ([value, star]) => resolveTarget(value, star)),
    onNone: () => whenRootSubpath(subpath, () => Option.some(resolveTarget(exports, Option.none()))),
  })

const decide = (command: ResolvePackageExportsCommand): Result.Result<PackageExportsResolution, never> =>
  Result.succeed(
    resolveExports(command.exports, command.subpath).pipe(Option.getOrElse(() => TRY_NEXT_ENTRY), resolutionOf),
  )

export const resolvePackageExports = Workflow.make({
  command: ResolvePackageExportsCommand,
  decision: PackageExportsResolution,
  error: S.Never,
  decide,
})
