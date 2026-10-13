import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ManifestPackageTarget,
  ManifestPathTarget,
  type ManifestTarget,
  ManifestTargetCommand,
  ManifestTargetMissing,
  ManifestTargetSchema,
  type PackageManifest,
} from './import-closure.schema.js'

const PACKAGE_SOURCE_CONDITION = '@systemfsoftware/source'

const DEFAULT_ENTRY_KEY = '.'

const PATTERN_WILDCARD = '*'

const PACKAGE_RELATIVE_PREFIX = './'

const INVALID_IMPORT_TARGET_PREFIXES: readonly string[] = ['.', '/', '#']

const INVALID_TARGET_SEGMENTS: readonly string[] = ['.', '..', 'node_modules']

const TARGET_SEGMENT_SEPARATOR = /[/\\]/

interface PatternMatch {
  readonly key: string
  readonly prefix: string
  readonly captured: string
}

const isEntryMap = (value: S.Json): value is S.JsonObject => Predicate.isObject(value)

const ownValueOf = (record: S.JsonObject, key: string): Option.Option<S.Json> =>
  Boolean.match(Object.hasOwn(record, key), {
    onTrue: () => Option.fromUndefinedOr(record[key]),
    onFalse: () => Option.none(),
  })

const stringOf = (value: S.Json): Option.Option<string> => Option.liftPredicate(value, Predicate.isString)

const isEntryList = (value: S.Json): value is ReadonlyArray<S.Json> => Array.isArray(value)

const conditionValueOption = (conditions: S.JsonObject): Option.Option<S.Json> =>
  Option.orElse(ownValueOf(conditions, PACKAGE_SOURCE_CONDITION), () => Arr.head(Object.values(conditions)))

const entryTargetOfEntry = (entry: S.Json): Option.Option<string> =>
  Match.value(entry).pipe(
    Match.when(Predicate.isString, (target) => Option.some(target)),
    Match.when(isEntryList, (fallbacks) => Option.flatMap(Arr.head(fallbacks), entryTargetOfEntry)),
    Match.when(isEntryMap, (conditions) => Option.flatMap(conditionValueOption(conditions), entryTargetOfEntry)),
    Match.orElse(() => Option.none()),
  )

const entryTargetOption = (entries: S.JsonObject, key: string): Option.Option<string> =>
  Option.flatMap(ownValueOf(entries, key), entryTargetOfEntry)

const patternMatchOf = (matchKey: string) => (key: string): Option.Option<PatternMatch> => {
  const star = key.indexOf(PATTERN_WILDCARD)
  const prefix = key.slice(0, star)
  const suffix = key.slice(star + 1)
  const matches = [
    star >= 0,
    star === key.lastIndexOf(PATTERN_WILDCARD),
    matchKey.startsWith(prefix),
    matchKey.endsWith(suffix),
    matchKey.length >= key.length,
  ].every((flag) => flag)
  return Option.map(Option.liftPredicate(matchKey, () => matches), () => ({
    key,
    prefix,
    captured: matchKey.slice(prefix.length, matchKey.length - suffix.length),
  }))
}

const PATTERN_PRECEDENCE: Order.Order<PatternMatch> = Order.combine(
  Order.mapInput(Order.flip(Order.Number), (match: PatternMatch) => match.prefix.length),
  Order.mapInput(Order.flip(Order.Number), (match: PatternMatch) => match.key.length),
)

const exactEntryOption = (entries: S.JsonObject, key: string): Option.Option<Option.Option<string>> =>
  Option.map(ownValueOf(entries, key), entryTargetOfEntry)

const patternEntryOption = (entries: S.JsonObject, matchKey: string): Option.Option<Option.Option<string>> =>
  Option.map(
    Arr.head(Arr.sort(Arr.getSomes(Object.keys(entries).map(patternMatchOf(matchKey))), PATTERN_PRECEDENCE)),
    (match) =>
      Option.map(
        entryTargetOption(entries, match.key),
        (target) => target.replaceAll(PATTERN_WILDCARD, () => match.captured),
      ),
  )

const mapEntryOption = (entries: S.JsonObject, matchKey: string): Option.Option<Option.Option<string>> =>
  Option.orElse(exactEntryOption(entries, matchKey), () => patternEntryOption(entries, matchKey))

const isRootSubpath = (subpath: string): boolean => subpath.length === 0

const entryKeyOf = (subpath: string): string =>
  Boolean.match(isRootSubpath(subpath), {
    onTrue: () => DEFAULT_ENTRY_KEY,
    onFalse: () => `${PACKAGE_RELATIVE_PREFIX}${subpath}`,
  })

const rootEntryOption = (root: S.Json, subpath: string): Option.Option<Option.Option<string>> =>
  Option.liftPredicate(entryTargetOfEntry(root), () => isRootSubpath(subpath))

const exportsEntryOption = (exports: S.Json, subpath: string): Option.Option<Option.Option<string>> =>
  Match.value(exports).pipe(
    Match.when(isEntryMap, (entries) => mapEntryOption(entries, entryKeyOf(subpath))),
    Match.when(Predicate.isString, (root) => rootEntryOption(root, subpath)),
    Match.when(isEntryList, (root) => rootEntryOption(root, subpath)),
    Match.orElse(() => Option.none()),
  )

const hasInvalidSegment = (target: string): boolean =>
  target
    .slice(PACKAGE_RELATIVE_PREFIX.length)
    .split(TARGET_SEGMENT_SEPARATOR)
    .some((segment) => INVALID_TARGET_SEGMENTS.includes(segment.toLowerCase()))

const pathTargetOf = (target: string): ManifestTarget => ManifestPathTarget.make({ target })

const missingTarget = (): ManifestTarget => ManifestTargetMissing.make({})

const mapPathTargetOf = (target: string): ManifestTarget =>
  Boolean.match([target.startsWith(PACKAGE_RELATIVE_PREFIX), hasInvalidSegment(target)].every((flag) => flag), {
    onTrue: missingTarget,
    onFalse: () => pathTargetOf(target),
  })

const mainTargetOption = (manifest: PackageManifest): Option.Option<string> =>
  Option.orElse(
    Option.flatMap(Option.fromUndefinedOr(manifest.main), stringOf),
    () => Option.flatMap(Option.fromUndefinedOr(manifest.module), stringOf),
  )

const rootFallbackOption = (manifest: PackageManifest, subpath: string): Option.Option<string> =>
  Option.flatMap(Option.liftPredicate(subpath, isRootSubpath), () => mainTargetOption(manifest))

const declaredTargetOf = (target: Option.Option<string>): ManifestTarget =>
  Option.match(target, { onNone: missingTarget, onSome: mapPathTargetOf })

const fallbackTargetOf = (manifest: PackageManifest, subpath: string): ManifestTarget =>
  Option.match(rootFallbackOption(manifest, subpath), { onNone: missingTarget, onSome: pathTargetOf })

const exportTargetOf = (manifest: PackageManifest, subpath: string): ManifestTarget =>
  Option.match(
    Option.flatMap(Option.fromUndefinedOr(manifest.exports), (exports) => exportsEntryOption(exports, subpath)),
    { onNone: () => fallbackTargetOf(manifest, subpath), onSome: declaredTargetOf },
  )

const importTargetOption = (manifest: PackageManifest, specifier: string): Option.Option<string> =>
  Option.flatMap(
    Option.filter(Option.fromUndefinedOr(manifest.imports), isEntryMap),
    (imports) => Option.flatten(mapEntryOption(imports, specifier)),
  )

const isInvalidImportTarget = (target: string): boolean =>
  [target.length === 0, ...INVALID_IMPORT_TARGET_PREFIXES.map((prefix) => target.startsWith(prefix))].some((flag) =>
    flag
  )

const importTargetOf = (target: string): ManifestTarget =>
  Match.value(target).pipe(
    Match.when((value: string) => value.startsWith(PACKAGE_RELATIVE_PREFIX), mapPathTargetOf),
    Match.when(isInvalidImportTarget, missingTarget),
    Match.orElse((value): ManifestTarget => ManifestPackageTarget.make({ specifier: value })),
  )

const targetOf = (command: ManifestTargetCommand): ManifestTarget =>
  Match.value(command.request).pipe(
    Match.tag('PackageExportRequest', ({ subpath }) => exportTargetOf(command.manifest, subpath)),
    Match.tag('PackageImportRequest', ({ specifier }) =>
      Option.match(importTargetOption(command.manifest, specifier), {
        onNone: missingTarget,
        onSome: importTargetOf,
      })),
    Match.exhaustive,
  )

const decide = (command: ManifestTargetCommand): Result.Result<ManifestTarget, never> =>
  Result.succeed(targetOf(command))

export const selectManifestTarget = Workflow.make({
  command: ManifestTargetCommand,
  decision: ManifestTargetSchema,
  error: S.Never,
  decide,
})
