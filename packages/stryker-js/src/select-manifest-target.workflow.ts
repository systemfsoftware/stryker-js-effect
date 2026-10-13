import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type EntryMap,
  ManifestPackageTarget,
  ManifestPathTarget,
  type ManifestTarget,
  ManifestTargetCommand,
  ManifestTargetMissing,
  ManifestTargetSchema,
  type PackageEntry,
  type PackageEntryField,
  type PackageManifest,
} from './import-closure.schema.js'

const PACKAGE_SOURCE_CONDITION = '@systemfsoftware/source'

const ESM_CONDITIONS: ReadonlyArray<string> = ['import', 'node', 'module-sync', 'node-addons', 'default']

const COMMONJS_CONDITIONS: ReadonlyArray<string> = ['require', 'node', 'module-sync', 'node-addons', 'default']

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

type EntryTable = EntryMap['entries']

type TargetValidity = (target: string) => boolean

const isPackageRelative = (target: string): boolean => target.startsWith(PACKAGE_RELATIVE_PREFIX)

const hasInvalidSegment = (target: string): boolean =>
  target
    .slice(PACKAGE_RELATIVE_PREFIX.length)
    .split(TARGET_SEGMENT_SEPARATOR)
    .some((segment) => INVALID_TARGET_SEGMENTS.includes(segment.toLowerCase()))

const isValidPathTarget: TargetValidity = (target) =>
  [isPackageRelative(target), !hasInvalidSegment(target)].every((flag) => flag)

const isInvalidImportTarget = (target: string): boolean =>
  [target.length === 0, ...INVALID_IMPORT_TARGET_PREFIXES.map((prefix) => target.startsWith(prefix))].some((flag) =>
    flag
  )

const isValidImportTarget: TargetValidity = (target) =>
  Boolean.match(isPackageRelative(target), {
    onTrue: () => !hasInvalidSegment(target),
    onFalse: () => !isInvalidImportTarget(target),
  })

const ownValueOf = (record: EntryTable, key: string): Option.Option<PackageEntry> =>
  Boolean.match(Object.hasOwn(record, key), {
    onTrue: () => Option.fromUndefinedOr(record[key]),
    onFalse: () => Option.none(),
  })

type Resolution = Option.Option<Option.Option<string>>

type InvalidPackageConfig = 'invalid-package-config'

type Read = Result.Result<Resolution, InvalidPackageConfig>

const unmatched: Read = Result.succeed(Option.none())

const blocked: Read = Option.none<string>().pipe(Option.some, Result.succeed)

const refused: Read = Result.fail('invalid-package-config')

const ARRAY_INDEX_LIMIT = 0xFFFF_FFFF

const isArrayIndex = (key: string): boolean => {
  const index = Number(key)
  return [`${index}` === key, index >= 0, index < ARRAY_INDEX_LIMIT].every((flag) => flag)
}

const isDecided = (read: Read): boolean => Result.match(read, { onFailure: () => true, onSuccess: Option.isSome })

const endsFallbacks = (read: Read): boolean =>
  Result.match(read, { onFailure: () => true, onSuccess: (outcome) => outcome.pipe(Option.flatten, Option.isSome) })

const firstDecided = (reads: ReadonlyArray<Read>): Read =>
  Option.getOrElse(Arr.findFirst(reads, isDecided), () => unmatched)

const fallbacksRead = (reads: ReadonlyArray<Read>): Read =>
  Arr.match(reads, {
    onEmpty: () => blocked,
    onNonEmpty: (present) =>
      Option.getOrElse(
        Arr.findFirst(present, endsFallbacks),
        () => Option.match(Arr.findFirst(present, isDecided), { onNone: () => unmatched, onSome: () => blocked }),
      ),
  })

const matchedEntries = (entries: EntryTable, conditions: ReadonlyArray<string>): ReadonlyArray<PackageEntry> =>
  Arr.getSomes(Object.keys(entries).filter((key) => conditions.includes(key)).map((key) => ownValueOf(entries, key)))

const conditionsRead = (entries: EntryTable, conditions: ReadonlyArray<string>, isValid: TargetValidity): Read =>
  Option.match(ownValueOf(entries, PACKAGE_SOURCE_CONDITION), {
    onSome: readIn(conditions, isValid),
    onNone: () => firstDecided(matchedEntries(entries, conditions).map(readIn(conditions, isValid))),
  })

const readIn = (conditions: ReadonlyArray<string>, isValid: TargetValidity) => (entry: PackageEntry): Read =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
      EntryPath: ({ path }): Read => Option.liftPredicate(path, isValid).pipe(Option.some, Result.succeed),
      EntryNull: (): Read => blocked,
      EntryScalar: (): Read => blocked,
      EntryFallbacks: ({ fallbacks }): Read => fallbacksRead(fallbacks.map(readIn(conditions, isValid))),
      EntryMap: ({ entries }): Read =>
        Boolean.match(Object.keys(entries).some(isArrayIndex), {
          onTrue: () => refused,
          onFalse: () => conditionsRead(entries, conditions, isValid),
        }),
    }),
  )

const fileReadIn = (conditions: ReadonlyArray<string>, isValid: TargetValidity) => (entry: PackageEntry) =>
  Result.match(readIn(conditions, isValid)(entry), {
    onFailure: (): Option.Option<string> => Option.none(),
    onSuccess: Option.flatten,
  })

const loadedTargetOf = (esm: Option.Option<string>, commonJs: Option.Option<string>): Option.Option<string> =>
  Option.match(esm, {
    onNone: () => commonJs,
    onSome: (esmTarget) =>
      Option.match(commonJs, {
        onNone: () => Option.some(esmTarget),
        onSome: (commonJsTarget) => Option.liftPredicate(esmTarget, (target) => target === commonJsTarget),
      }),
  })

const entryTargetOfEntry = (isValid: TargetValidity) => (entry: PackageEntry): Option.Option<string> =>
  loadedTargetOf(fileReadIn(ESM_CONDITIONS, isValid)(entry), fileReadIn(COMMONJS_CONDITIONS, isValid)(entry))

const exactEntryOption = (
  entries: EntryTable,
  key: string,
  isValid: TargetValidity,
): Option.Option<Option.Option<string>> => Option.map(ownValueOf(entries, key), entryTargetOfEntry(isValid))

const entryTargetOption = (entries: EntryTable, key: string, isValid: TargetValidity): Option.Option<string> =>
  Option.flatten(exactEntryOption(entries, key, isValid))

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

const patternEntryOption = (
  entries: EntryTable,
  matchKey: string,
  isValid: TargetValidity,
): Option.Option<Option.Option<string>> =>
  Option.map(
    Arr.head(Arr.sort(Arr.getSomes(Object.keys(entries).map(patternMatchOf(matchKey))), PATTERN_PRECEDENCE)),
    (match) =>
      Option.map(
        entryTargetOption(entries, match.key, isValid),
        (target) => target.replaceAll(PATTERN_WILDCARD, () => match.captured),
      ),
  )

const mapEntryOption = (
  entries: EntryTable,
  matchKey: string,
  isValid: TargetValidity,
): Option.Option<Option.Option<string>> =>
  Option.orElse(exactEntryOption(entries, matchKey, isValid), () => patternEntryOption(entries, matchKey, isValid))

const isRootSubpath = (subpath: string): boolean => subpath.length === 0

const entryKeyOf = (subpath: string): string =>
  Boolean.match(isRootSubpath(subpath), {
    onTrue: () => DEFAULT_ENTRY_KEY,
    onFalse: () => `${PACKAGE_RELATIVE_PREFIX}${subpath}`,
  })

const rootEntryOption = (root: PackageEntry, subpath: string): Option.Option<Option.Option<string>> =>
  Boolean.match(isRootSubpath(subpath), {
    onTrue: () => Option.some(entryTargetOfEntry(isValidPathTarget)(root)),
    onFalse: () => Option.none(),
  })

const isSubpathKey = (key: string): boolean => key.startsWith(DEFAULT_ENTRY_KEY)

const objectExportsOption = (map: EntryMap, subpath: string): Option.Option<Option.Option<string>> =>
  Match.value(Object.keys(map.entries)).pipe(
    Match.when(
      (keys) => keys.every(isSubpathKey),
      () => mapEntryOption(map.entries, entryKeyOf(subpath), isValidPathTarget),
    ),
    Match.when((keys) => !keys.some(isSubpathKey), () => rootEntryOption(map, subpath)),
    Match.orElse(() => Option.some(Option.none<string>())),
  )

const exportsEntryOption = (exports: PackageEntryField, subpath: string): Option.Option<Option.Option<string>> =>
  Match.value(exports).pipe(
    Match.tagsExhaustive({
      EntryMap: (map) => objectExportsOption(map, subpath),
      EntryPath: (root) => rootEntryOption(root, subpath),
      EntryFallbacks: (root) => rootEntryOption(root, subpath),
      EntryNull: (): Option.Option<Option.Option<string>> => Option.none(),
      EntryScalar: (): Option.Option<Option.Option<string>> => Option.none(),
      EntryUndeclared: (): Option.Option<Option.Option<string>> => Option.none(),
    }),
  )

const pathTargetOf = (target: string): ManifestTarget => ManifestPathTarget.make({ target })

const missingTarget = (): ManifestTarget => ManifestTargetMissing.make({})

const mapPathTargetOf = (target: string): ManifestTarget =>
  Boolean.match([target.startsWith(PACKAGE_RELATIVE_PREFIX), hasInvalidSegment(target)].every((flag) => flag), {
    onTrue: missingTarget,
    onFalse: () => pathTargetOf(target),
  })

const pathOf = (field: PackageEntryField): Option.Option<string> =>
  Match.value(field).pipe(
    Match.tagsExhaustive({
      EntryPath: ({ path }): Option.Option<string> => Option.some(path),
      EntryFallbacks: (): Option.Option<string> => Option.none(),
      EntryMap: (): Option.Option<string> => Option.none(),
      EntryNull: (): Option.Option<string> => Option.none(),
      EntryScalar: (): Option.Option<string> => Option.none(),
      EntryUndeclared: (): Option.Option<string> => Option.none(),
    }),
  )

const mainTargetOption = (manifest: PackageManifest): Option.Option<string> =>
  Match.value(manifest.main).pipe(
    Match.tagsExhaustive({
      EntryPath: ({ path }): Option.Option<string> => Option.some(path),
      EntryUndeclared: (): Option.Option<string> => pathOf(manifest.module),
      EntryFallbacks: (): Option.Option<string> => Option.none(),
      EntryMap: (): Option.Option<string> => Option.none(),
      EntryNull: (): Option.Option<string> => Option.none(),
      EntryScalar: (): Option.Option<string> => Option.none(),
    }),
  )

const rootFallbackOption = (manifest: PackageManifest, subpath: string): Option.Option<string> =>
  Option.flatMap(Option.liftPredicate(subpath, isRootSubpath), () => mainTargetOption(manifest))

const declaredTargetOf = (target: Option.Option<string>): ManifestTarget =>
  Option.match(target, { onNone: missingTarget, onSome: mapPathTargetOf })

const fallbackTargetOf = (manifest: PackageManifest, subpath: string): ManifestTarget =>
  Option.match(rootFallbackOption(manifest, subpath), { onNone: missingTarget, onSome: pathTargetOf })

const exportTargetOf = (manifest: PackageManifest, subpath: string): ManifestTarget =>
  Option.match(exportsEntryOption(manifest.exports, subpath), {
    onNone: () => fallbackTargetOf(manifest, subpath),
    onSome: declaredTargetOf,
  })

const importEntriesOption = (imports: PackageEntryField): Option.Option<EntryTable> =>
  Match.value(imports).pipe(
    Match.tagsExhaustive({
      EntryMap: ({ entries }): Option.Option<EntryTable> => Option.some(entries),
      EntryPath: (): Option.Option<EntryTable> => Option.none(),
      EntryFallbacks: (): Option.Option<EntryTable> => Option.none(),
      EntryNull: (): Option.Option<EntryTable> => Option.none(),
      EntryScalar: (): Option.Option<EntryTable> => Option.none(),
      EntryUndeclared: (): Option.Option<EntryTable> => Option.none(),
    }),
  )

const importTargetOption = (manifest: PackageManifest, specifier: string): Option.Option<string> =>
  Option.flatMap(
    importEntriesOption(manifest.imports),
    (imports) => Option.flatten(mapEntryOption(imports, specifier, isValidImportTarget)),
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
