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
  type ExportEntry,
  ManifestPackageTarget,
  ManifestPathTarget,
  type ManifestTarget,
  ManifestTargetCommand,
  ManifestTargetMissing,
  ManifestTargetSchema,
  type PackageManifest,
} from './import-closure.schema.js'

type EntryMap = Readonly<Record<string, ExportEntry>>

const PACKAGE_SOURCE_CONDITION = '@systemfsoftware/source'

const DEFAULT_ENTRY_KEY = '.'

const WILDCARD_ENTRY_KEY = './*'

const PATTERN_WILDCARD = '*'

const PACKAGE_RELATIVE_PREFIX = './'

const INVALID_IMPORT_TARGET_PREFIXES: readonly string[] = ['.', '/', '#']

interface PatternMatch {
  readonly key: string
  readonly prefix: string
  readonly captured: string
}

const ownValueOf = <A>(record: Readonly<Record<string, A>>, key: string): Option.Option<A> =>
  Boolean.match(Object.hasOwn(record, key), {
    onTrue: () => Option.fromUndefinedOr(record[key]),
    onFalse: () => Option.none(),
  })

const conditionTargetOption = (conditions: Readonly<Record<string, string>>): Option.Option<string> =>
  Option.orElse(ownValueOf(conditions, PACKAGE_SOURCE_CONDITION), () => Arr.head(Object.values(conditions)))

const entryTargetOfEntry = (entry: ExportEntry): Option.Option<string> =>
  Match.value(entry).pipe(
    Match.when(Predicate.isString, (target) => Option.some(target)),
    Match.orElse(conditionTargetOption),
  )

const entryTargetOption = (entries: EntryMap, key: string): Option.Option<string> =>
  Option.flatMap(ownValueOf(entries, key), entryTargetOfEntry)

const isRootSubpath = (subpath: string): boolean => subpath.length === 0

const entryKeyOf = (subpath: string): string =>
  Boolean.match(isRootSubpath(subpath), {
    onTrue: () => DEFAULT_ENTRY_KEY,
    onFalse: () => `${PACKAGE_RELATIVE_PREFIX}${subpath}`,
  })

const wildcardTargetOption = (entries: EntryMap, subpath: string): Option.Option<string> =>
  Option.map(
    Option.flatMap(Option.liftPredicate(subpath, Predicate.not(isRootSubpath)), () =>
      entryTargetOption(entries, WILDCARD_ENTRY_KEY)),
    (target) =>
      target.replace(PATTERN_WILDCARD, () => subpath),
  )

const mapTargetOption = (entries: EntryMap, subpath: string): Option.Option<string> =>
  Option.orElse(entryTargetOption(entries, entryKeyOf(subpath)), () => wildcardTargetOption(entries, subpath))

const rootTargetOption = (target: string, subpath: string): Option.Option<string> =>
  Option.liftPredicate(target, () => isRootSubpath(subpath))

const exportsTargetOption = (exports: string | EntryMap, subpath: string): Option.Option<string> =>
  Match.value(exports).pipe(
    Match.when(Predicate.isString, (target) => rootTargetOption(target, subpath)),
    Match.orElse((entries) => mapTargetOption(entries, subpath)),
  )

const mainTargetOption = (manifest: PackageManifest): Option.Option<string> =>
  Option.orElse(Option.fromUndefinedOr(manifest.main), () => Option.fromUndefinedOr(manifest.module))

const rootFallbackOption = (manifest: PackageManifest, subpath: string): Option.Option<string> =>
  Option.flatMap(Option.liftPredicate(subpath, isRootSubpath), () => mainTargetOption(manifest))

const exportTargetOption = (manifest: PackageManifest, subpath: string): Option.Option<string> =>
  Option.orElse(
    Option.flatMap(Option.fromUndefinedOr(manifest.exports), (exports) => exportsTargetOption(exports, subpath)),
    () => rootFallbackOption(manifest, subpath),
  )

const patternMatchOf = (specifier: string) => (key: string): Option.Option<PatternMatch> => {
  const star = key.indexOf(PATTERN_WILDCARD)
  const prefix = key.slice(0, star)
  const suffix = key.slice(star + 1)
  const matches = [
    star >= 0,
    star === key.lastIndexOf(PATTERN_WILDCARD),
    specifier.startsWith(prefix),
    specifier.endsWith(suffix),
    specifier.length >= key.length,
  ].every((flag) => flag)
  return Option.map(Option.liftPredicate(specifier, () => matches), () => ({
    key,
    prefix,
    captured: specifier.slice(prefix.length, specifier.length - suffix.length),
  }))
}

const PATTERN_PRECEDENCE: Order.Order<PatternMatch> = Order.combine(
  Order.mapInput(Order.flip(Order.Number), (match: PatternMatch) => match.prefix.length),
  Order.mapInput(Order.flip(Order.Number), (match: PatternMatch) => match.key.length),
)

const patternTargetOption = (entries: EntryMap, specifier: string): Option.Option<string> =>
  Option.flatMap(
    Arr.head(Arr.sort(Arr.getSomes(Object.keys(entries).map(patternMatchOf(specifier))), PATTERN_PRECEDENCE)),
    (match) =>
      Option.map(entryTargetOption(entries, match.key), (target) =>
        target.replaceAll(PATTERN_WILDCARD, () => match.captured)),
  )

const importTargetOption = (manifest: PackageManifest, specifier: string): Option.Option<string> =>
  Option.flatMap(
    Option.fromUndefinedOr(manifest.imports),
    (imports) => Option.orElse(entryTargetOption(imports, specifier), () => patternTargetOption(imports, specifier)),
  )

const isInvalidImportTarget = (target: string): boolean =>
  [target.length === 0, ...INVALID_IMPORT_TARGET_PREFIXES.map((prefix) => target.startsWith(prefix))].some((flag) =>
    flag
  )

const importTargetOf = (target: string): ManifestTarget =>
  Match.value(target).pipe(
    Match.when((value: string) => value.startsWith(PACKAGE_RELATIVE_PREFIX), (value): ManifestTarget =>
      ManifestPathTarget.make({ target: value })),
    Match.when(isInvalidImportTarget, (): ManifestTarget =>
      ManifestTargetMissing.make({})),
    Match.orElse((value): ManifestTarget => ManifestPackageTarget.make({ specifier: value })),
  )

const pathTargetOf = (target: string): ManifestTarget => ManifestPathTarget.make({ target })

const missingTarget = (): ManifestTarget => ManifestTargetMissing.make({})

const targetOf = (command: ManifestTargetCommand): ManifestTarget =>
  Match.value(command.request).pipe(
    Match.tag('PackageExportRequest', ({ subpath }) =>
      Option.match(exportTargetOption(command.manifest, subpath), { onNone: missingTarget, onSome: pathTargetOf })),
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
