import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type PackageExportValue, PackageManifestFields } from './package-manifest.schema.js'

export class SelectPackageEntryCommand extends S.TaggedClass<SelectPackageEntryCommand>()(
  'SelectPackageEntryCommand',
  {
    specifier: S.String,
    manifest: PackageManifestFields,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    specifier: 'stryker.package_entry.specifier',
  } as const
}

const SelectPackageEntryTypeId = Symbol.for('@systemfsoftware/stryker-js/SelectPackageEntryDecision')
type SelectPackageEntryTypeId = typeof SelectPackageEntryTypeId

export class PackageEntrySelected extends S.TaggedClass<PackageEntrySelected>()('PackageEntrySelected', {
  specifier: S.String,
  entry: S.String,
}) {
  readonly [SelectPackageEntryTypeId] = SelectPackageEntryTypeId
}

export class PackageEntryUnresolved extends S.TaggedClass<PackageEntryUnresolved>()('PackageEntryUnresolved', {
  specifier: S.String,
  reason: S.String,
}) {
  readonly [SelectPackageEntryTypeId] = SelectPackageEntryTypeId
}

export const PackageEntryDecision = S.Union([PackageEntrySelected, PackageEntryUnresolved])
export type PackageEntryDecision = typeof PackageEntryDecision.Type

const CONDITION_ORDER: readonly string[] = ['node', 'import', 'default']

const Selected = S.TaggedStruct('Selected', { target: S.String })
const Unmatched = S.TaggedStruct('Unmatched', { key: S.String })
const Undeclared = S.TaggedStruct('Undeclared', {})
const Wildcard = S.TaggedStruct('Wildcard', {})
const Nullish = S.TaggedStruct('Nullish', {})
const NotRelative = S.TaggedStruct('NotRelative', { target: S.String })
const Selection = S.Union([Selected, Unmatched, Undeclared, Wildcard, Nullish, NotRelative])
type Selection = S.Schema.Type<typeof Selection>

const isString = (value: PackageExportValue): value is string => typeof value === 'string'
const isArray = (value: PackageExportValue): value is readonly PackageExportValue[] => Array.isArray(value)
const isMapRecord = (value: PackageExportValue): value is { readonly [key: string]: PackageExportValue } =>
  Predicate.isObject(value)

const subpathOf = (specifier: string): string => {
  const segments = specifier.split('/')
  const nameSegments = Match.value(specifier.startsWith('@')).pipe(
    Match.when(true, () => 2),
    Match.orElse(() => 1),
  )
  return segments.slice(nameSegments).join('/')
}

const exportKeyOf = (subpath: string): string =>
  Match.value(subpath.length === 0).pipe(
    Match.when(true, () => '.'),
    Match.orElse(() => `./${subpath}`),
  )

const checkedTargetOf = (target: string, relative: (candidate: string) => Selection): Selection =>
  Option.match(
    Option.some(target).pipe(Option.filter((candidate) => candidate.includes('*'))),
    {
      onSome: (): Selection => Wildcard.make({}),
      onNone: () => relative(target),
    },
  )

const stringTargetOf = (target: string): Selection =>
  checkedTargetOf(
    target,
    () =>
      Match.value(target.startsWith('./')).pipe(
        Match.when(true, (): Selection => Selected.make({ target })),
        Match.orElse((): Selection => NotRelative.make({ target })),
      ),
  )

const fileTargetOf = (target: string): Selection =>
  checkedTargetOf(
    target,
    () =>
      Match.value(target.startsWith('/')).pipe(
        Match.when(true, (): Selection => NotRelative.make({ target })),
        Match.orElse((): Selection => Selected.make({ target })),
      ),
  )

const arrayTargetOf = (elements: readonly PackageExportValue[]): Selection =>
  Option.match(Option.fromUndefinedOr(elements.at(0)), {
    onNone: (): Selection => Nullish.make({}),
    onSome: (first) => targetOfValue(first),
  })

const conditionTargetOf = (conditions: { readonly [key: string]: PackageExportValue }): Selection =>
  Option.match(
    Option.fromUndefinedOr(
      CONDITION_ORDER.flatMap((name) =>
        Option.match(Option.fromUndefinedOr(conditions[name]), {
          onNone: () => [],
          onSome: (value) => [targetOfValue(value)],
        })
      ).at(0),
    ),
    { onNone: (): Selection => Nullish.make({}), onSome: (found) => found },
  )

const targetOfValue = (value: PackageExportValue): Selection =>
  Match.value(value).pipe(
    Match.when(isString, (target): Selection => stringTargetOf(target)),
    Match.when(isArray, (elements): Selection => arrayTargetOf(elements)),
    Match.when(isMapRecord, (map): Selection => conditionTargetOf(map)),
    Match.orElse((): Selection => Nullish.make({})),
  )

const matchedOf = (selection: Selection, key: string): Selection =>
  Match.value(selection).pipe(
    Match.tag('Selected', () =>
      Match.value(key).pipe(
        Match.when('.', (): Selection => selection),
        Match.orElse((): Selection => Unmatched.make({ key })),
      )),
    Match.orElse((): Selection => selection),
  )

const isSubpathMap = (map: { readonly [key: string]: PackageExportValue }): boolean =>
  Object.keys(map).some((key) => key.startsWith('.'))

const mappedTargetOf = (map: { readonly [key: string]: PackageExportValue }, key: string): Selection =>
  Match.value(isSubpathMap(map)).pipe(
    Match.when(true, (): Selection =>
      Option.match(Option.fromUndefinedOr(map[key]), {
        onNone: (): Selection => Unmatched.make({ key }),
        onSome: (target): Selection => targetOfValue(target),
      })),
    Match.orElse((): Selection => matchedOf(conditionTargetOf(map), key)),
  )

const declaredTargetOf = (
  exports: S.Schema.Type<typeof PackageManifestFields>['exports'],
  key: string,
): Selection =>
  Option.match(Option.fromUndefinedOr(exports), {
    onNone: (): Selection => Nullish.make({}),
    onSome: (value) => targetOfKey(value, key),
  })

const targetOfKey = (value: PackageExportValue, key: string): Selection =>
  Match.value(value).pipe(
    Match.when(isMapRecord, (map): Selection => mappedTargetOf(map, key)),
    Match.orElse((): Selection => matchedOf(targetOfValue(value), key)),
  )

const declaredEntryOf = (manifest: S.Schema.Type<typeof PackageManifestFields>): Selection =>
  Option.match(Option.fromNullishOr(manifest.module), {
    onSome: (entry): Selection => checkedTargetOf(entry, fileTargetOf),
    onNone: () =>
      Option.match(Option.fromNullishOr(manifest.main), {
        onSome: (entry): Selection => checkedTargetOf(entry, fileTargetOf),
        onNone: (): Selection => Undeclared.make({}),
      }),
  })

const selectionOf = (command: SelectPackageEntryCommand): Selection =>
  Option.match(Option.fromUndefinedOr(command.manifest.exports), {
    onSome: (exports) => declaredTargetOf(exports, exportKeyOf(subpathOf(command.specifier))),
    onNone: () => declaredEntryOf(command.manifest),
  })

const unresolvedOf = (specifier: string, reason: string): PackageEntryUnresolved =>
  PackageEntryUnresolved.make({ specifier, reason })

export const selectPackageEntry = Workflow.make({
  command: SelectPackageEntryCommand,
  decision: PackageEntryDecision,
  error: S.Never,
  decide: (command): Result.Result<PackageEntryDecision, never> =>
    Match.value(selectionOf(command)).pipe(
      Match.tag('Selected', ({ target }) =>
        Result.succeed<PackageEntryDecision>(
          PackageEntrySelected.make({ specifier: command.specifier, entry: target }),
        )),
      Match.tag('Undeclared', () =>
        Result.succeed<PackageEntryDecision>(
          unresolvedOf(command.specifier, `the package declares no "exports", "module", or "main" entry`),
        )),
      Match.tag('Unmatched', ({ key }) =>
        Result.succeed<PackageEntryDecision>(
          unresolvedOf(command.specifier, `the package does not export "${key}"`),
        )),
      Match.tag('Wildcard', () =>
        Result.succeed<PackageEntryDecision>(
          unresolvedOf(
            command.specifier,
            'the package declares a wildcard export, which this host does not resolve',
          ),
        )),
      Match.tag('Nullish', () =>
        Result.succeed<PackageEntryDecision>(
          unresolvedOf(command.specifier, 'the matching package export resolves to null'),
        )),
      Match.tag('NotRelative', ({ target }) =>
        Result.succeed<PackageEntryDecision>(
          unresolvedOf(command.specifier, `the package export "${target}" is not a relative path`),
        )),
      Match.exhaustive,
    ),
})
