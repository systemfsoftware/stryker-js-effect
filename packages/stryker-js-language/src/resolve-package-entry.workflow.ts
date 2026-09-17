import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Array from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PackageEntryTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-language/PackageEntry')
type PackageEntryTypeId = typeof PackageEntryTypeId

const EntryRefusalReason = S.Literals([
  'no-main-no-exports',
  'main-without-extension',
  'unsupported-exports-shape',
  'unmatched-subpath',
])

export type EntryRefusalReason = typeof EntryRefusalReason.Type

export class EntryFileFromExports extends S.TaggedClass<EntryFileFromExports>()('EntryFileFromExports', {
  path: S.String,
}) {
  readonly [PackageEntryTypeId] = PackageEntryTypeId
}

export class EntryFileFromMain extends S.TaggedClass<EntryFileFromMain>()('EntryFileFromMain', {
  path: S.String,
}) {
  readonly [PackageEntryTypeId] = PackageEntryTypeId
}

export type EntryFile = EntryFileFromExports | EntryFileFromMain

export class EntryRefusal extends S.TaggedError<EntryRefusal>()('EntryRefusal', {
  reason: EntryRefusalReason,
}) {}

export class ResolvePackageEntryCommand extends S.TaggedClass<ResolvePackageEntryCommand>()(
  'ResolvePackageEntryCommand',
  {
    manifest: S.Unknown,
    subpath: S.String,
  },
) {}

const CONDITION_PRIORITY = ['import', 'node', 'default']
const MAX_CONDITION_DEPTH = 32
const ENTRY_DEPTH = 0
const ROOT_SUBPATH = '.'
const MANIFEST_SUBPATH = './package.json'
const RELATIVE_PREFIX = './'
const PATTERN_WILDCARD = '*'
const EXPORTS_KEY = 'exports'
const MAIN_KEY = 'main'

const refuse = (reason: EntryRefusalReason): Result.Result<never, EntryRefusalReason> => Result.fail(reason)

const isString = (value: unknown): value is string => typeof value === 'string'

const isConditions = (value: unknown): value is Record<string, unknown> => S.is(S.Record(S.String, S.Unknown))(value)

const asConditions = (value: unknown): Option.Option<Record<string, unknown>> =>
  Option.filter(Option.fromUndefinedOr(value), isConditions)

const asString = (value: unknown): Option.Option<string> => Option.filter(Option.fromUndefinedOr(value), isString)

const fieldOf = (record: Record<string, unknown>, key: string): Option.Option<unknown> =>
  Option.filter(Option.fromUndefinedOr(record[key]), () => Object.hasOwn(record, key))

const relativeTarget = (value: unknown): Option.Option<string> =>
  Option.flatMap(
    asString(value),
    (target) => Option.filter(Option.some(target), (path) => path.startsWith(RELATIVE_PREFIX)),
  )

const substitute = (target: string, capture: Option.Option<string>): string =>
  Option.match(capture, {
    onNone: () => target,
    onSome: (captured) => target.replaceAll(PATTERN_WILDCARD, captured),
  })

const withinConditionBudget = (depth: number): Option.Option<number> =>
  Option.filter(Option.some(depth), (level) => level < MAX_CONDITION_DEPTH)

const firstCondition = (conditions: Record<string, unknown>): Option.Option<unknown> =>
  Option.map(Array.findFirst(CONDITION_PRIORITY, (key) => Object.hasOwn(conditions, key)), (key) => conditions[key])

const selectConditions = (
  conditions: Record<string, unknown>,
  depth: number,
  capture: Option.Option<string>,
): Result.Result<string, EntryRefusalReason> =>
  Option.match(withinConditionBudget(depth), {
    onNone: () => refuse('unsupported-exports-shape'),
    onSome: () =>
      Option.match(firstCondition(conditions), {
        onNone: () => refuse('unsupported-exports-shape'),
        onSome: (target) => selectTarget(target, depth + 1, capture),
      }),
  })

const selectTarget = (
  target: unknown,
  depth: number,
  capture: Option.Option<string>,
): Result.Result<string, EntryRefusalReason> =>
  Option.match(asConditions(target), {
    onSome: (conditions) => selectConditions(conditions, depth, capture),
    onNone: () =>
      Option.match(relativeTarget(target), {
        onSome: (path) => Result.succeed(substitute(path, capture)),
        onNone: () => refuse('unsupported-exports-shape'),
      }),
  })

type PatternKey = { readonly key: string; readonly prefix: string; readonly suffix: string }

type PatternHit = { readonly target: unknown; readonly capture: string }

const singleWildcardOf = (key: string): Option.Option<number> =>
  Option.filter(
    Option.filter(Option.some(key.indexOf(PATTERN_WILDCARD)), (star) => star > -1),
    (star) => star === key.lastIndexOf(PATTERN_WILDCARD),
  )

const patternKeyOf = (key: string): Option.Option<PatternKey> =>
  Option.flatMap(
    Option.filter(Option.some(key), (candidate) => candidate.startsWith(RELATIVE_PREFIX)),
    (candidate) =>
      Option.map(singleWildcardOf(candidate), (star) => ({
        key: candidate,
        prefix: candidate.slice(0, star),
        suffix: candidate.slice(star + 1),
      })),
  )

const patternCapture = (subpath: string, pattern: PatternKey): Option.Option<string> =>
  Option.map(
    Option.filter(
      Option.filter(Option.some(subpath), (candidate) => candidate.startsWith(pattern.prefix)),
      (candidate) => candidate.endsWith(pattern.suffix),
    ),
    (candidate) => candidate.slice(pattern.prefix.length, candidate.length - pattern.suffix.length),
  )

const patternHitOf = (
  subpath: string,
  conditions: Record<string, unknown>,
  pattern: PatternKey,
): Option.Option<PatternHit> =>
  Option.map(patternCapture(subpath, pattern), (capture) => ({ target: conditions[pattern.key], capture }))

const mostSpecificFirst = (conditions: Record<string, unknown>): readonly PatternKey[] =>
  Array.getSomes(Array.map(Object.keys(conditions), patternKeyOf)).toSorted(
    (left, right) => right.prefix.length - left.prefix.length,
  )

const matchingPattern = (subpath: string, conditions: Record<string, unknown>): Option.Option<PatternHit> =>
  Option.flatMap(
    Array.findFirst(
      mostSpecificFirst(conditions),
      (pattern) => Option.isSome(patternHitOf(subpath, conditions, pattern)),
    ),
    (pattern) => patternHitOf(subpath, conditions, pattern),
  )

const entryFromExports = (path: string): EntryFile => new EntryFileFromExports({ path })

const selectPatternTarget = (
  conditions: Record<string, unknown>,
  subpath: string,
): Result.Result<string, EntryRefusalReason> =>
  Option.match(matchingPattern(subpath, conditions), {
    onNone: () => refuse('unmatched-subpath'),
    onSome: (hit) => selectTarget(hit.target, ENTRY_DEPTH, Option.some(hit.capture)),
  })

const selectExactOrPattern = (
  conditions: Record<string, unknown>,
  subpath: string,
): Result.Result<string, EntryRefusalReason> =>
  Option.match(fieldOf(conditions, subpath), {
    onNone: () => selectPatternTarget(conditions, subpath),
    onSome: (target) => selectTarget(target, ENTRY_DEPTH, Option.none()),
  })

const selectRootTarget = (exports: unknown): Result.Result<string, EntryRefusalReason> =>
  Option.match(asConditions(exports), {
    onSome: (conditions) =>
      Option.match(fieldOf(conditions, ROOT_SUBPATH), {
        onNone: () => refuse('unmatched-subpath'),
        onSome: (target) => selectTarget(target, ENTRY_DEPTH, Option.none()),
      }),
    onNone: () => selectTarget(exports, ENTRY_DEPTH, Option.none()),
  })

const selectSubpathTarget = (exports: unknown, subpath: string): Result.Result<string, EntryRefusalReason> =>
  Option.match(asConditions(exports), {
    onSome: (conditions) => selectExactOrPattern(conditions, subpath),
    onNone: () =>
      Option.match(relativeTarget(exports), {
        onSome: () => refuse('unmatched-subpath'),
        onNone: () => refuse('unsupported-exports-shape'),
      }),
  })

const baseName = (filePath: string): string => filePath.slice(filePath.lastIndexOf('/') + 1)

const extensionOf = (base: string): Option.Option<string> =>
  Option.flatMap(
    Option.filter(Option.some(base.lastIndexOf('.')), (dot) => dot > 0),
    (dot) => Option.filter(Option.some(base.slice(dot + 1)), (extension) => extension.length > 0),
  )

const selectMain = (record: Record<string, unknown>): Result.Result<EntryFile, EntryRefusalReason> =>
  Option.match(Option.flatMap(fieldOf(record, MAIN_KEY), asString), {
    onNone: () => refuse('no-main-no-exports'),
    onSome: (main) =>
      Option.match(extensionOf(baseName(main)), {
        onNone: () => refuse('main-without-extension'),
        onSome: () => Result.succeed(new EntryFileFromMain({ path: main })),
      }),
  })

const selectRoot = (record: Record<string, unknown>): Result.Result<EntryFile, EntryRefusalReason> =>
  Option.match(fieldOf(record, EXPORTS_KEY), {
    onNone: () => selectMain(record),
    onSome: (exports) => Result.map(selectRootTarget(exports), entryFromExports),
  })

const isSubpath = (subpath: string, expected: string): Option.Option<string> =>
  Option.filter(Option.some(subpath), (candidate) => candidate === expected)

const exactTargetOf = (exports: unknown, subpath: string): Option.Option<unknown> =>
  Option.flatMap(asConditions(exports), (conditions) => fieldOf(conditions, subpath))

const selectManifestEntry = (
  record: Record<string, unknown>,
  subpath: string,
): Result.Result<EntryFile, EntryRefusalReason> =>
  Option.match(fieldOf(record, EXPORTS_KEY), {
    onNone: () => Result.succeed(entryFromExports(subpath)),
    onSome: (exports) =>
      Option.match(exactTargetOf(exports, subpath), {
        onNone: () => Result.succeed(entryFromExports(subpath)),
        onSome: (target) => Result.map(selectTarget(target, ENTRY_DEPTH, Option.none()), entryFromExports),
      }),
  })

const selectSubpath = (
  record: Record<string, unknown>,
  subpath: string,
): Result.Result<EntryFile, EntryRefusalReason> =>
  Option.match(isSubpath(subpath, MANIFEST_SUBPATH), {
    onSome: () => selectManifestEntry(record, subpath),
    onNone: () =>
      Option.match(fieldOf(record, EXPORTS_KEY), {
        onNone: () => refuse('unmatched-subpath'),
        onSome: (exports) => Result.map(selectSubpathTarget(exports, subpath), entryFromExports),
      }),
  })

const selectEntry = (record: Record<string, unknown>, subpath: string): Result.Result<EntryFile, EntryRefusalReason> =>
  Option.match(isSubpath(subpath, ROOT_SUBPATH), {
    onSome: () => selectRoot(record),
    onNone: () => selectSubpath(record, subpath),
  })

const resolveEntry = (command: ResolvePackageEntryCommand): Result.Result<EntryFile, EntryRefusalReason> =>
  Option.match(asConditions(command.manifest), {
    onNone: () => refuse('no-main-no-exports'),
    onSome: (manifest) => selectEntry(manifest, command.subpath),
  })

export const resolvePackageEntry = Workflow.make(
  ResolvePackageEntryCommand,
  (command: ResolvePackageEntryCommand): Result.Result<EntryFile, EntryRefusal> =>
    Result.mapError(resolveEntry(command), (reason) => new EntryRefusal({ reason })),
)
