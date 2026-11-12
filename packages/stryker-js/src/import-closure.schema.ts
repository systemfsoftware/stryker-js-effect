import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

const ImportClosureTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/TestFileClosure')
type ImportClosureTypeId = typeof ImportClosureTypeId

export const ImportClosureModuleSchema = S.Struct({
  dependencies: S.Array(S.String),
  open: S.Boolean,
})
export type ImportClosureModule = typeof ImportClosureModuleSchema.Type

export type ImportClosureModuleTable = Readonly<Record<string, ImportClosureModule>>

export class ImportClosureCommand
  extends S.TaggedClass<ImportClosureCommand, { readonly brand: unique symbol }>()('ImportClosureCommand', {
    modules: S.Record(S.String, ImportClosureModuleSchema),
    globalInputs: S.Array(S.String),
    testFiles: S.Array(S.String),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class TestFileClosure
  extends S.TaggedClass<TestFileClosure, { readonly brand: unique symbol }>()('TestFileClosure', {
    testFile: S.String,
    files: S.Array(S.String),
    open: S.Boolean,
  })
{
  readonly [ImportClosureTypeId] = ImportClosureTypeId
}

const EntryPathSchema = S.TaggedStruct('EntryPath', { path: S.String })
export type EntryPath = typeof EntryPathSchema.Type

const EntryFallbacksTag = S.TaggedStruct('EntryFallbacks', {})
export type EntryFallbacks = typeof EntryFallbacksTag.Type & { readonly fallbacks: ReadonlyArray<PackageEntry> }

const EntryMapTag = S.TaggedStruct('EntryMap', {})
export type EntryMap = typeof EntryMapTag.Type & { readonly entries: { readonly [key: string]: PackageEntry } }

const EntryNullSchema = S.TaggedStruct('EntryNull', {})
export type EntryNull = typeof EntryNullSchema.Type

const EntryScalarSchema = S.TaggedStruct('EntryScalar', { value: S.Union([S.Finite, S.Boolean]) })
export type EntryScalar = typeof EntryScalarSchema.Type

export type PackageEntry = EntryPath | EntryFallbacks | EntryMap | EntryNull | EntryScalar

const EntryFallbacksSchema = EntryFallbacksTag.pipe(
  S.fieldsAssign({ fallbacks: S.Array(S.suspend((): S.Codec<PackageEntry> => PackageEntrySchema)) }),
)

const EntryMapSchema = EntryMapTag.pipe(
  S.fieldsAssign({ entries: S.Record(S.String, S.suspend((): S.Codec<PackageEntry> => PackageEntrySchema)) }),
)

export const PackageEntrySchema: S.Codec<PackageEntry> = S.suspend((): S.Codec<PackageEntry> =>
  S.Union([EntryPathSchema, EntryFallbacksSchema, EntryMapSchema, EntryNullSchema, EntryScalarSchema])
).annotate({ identifier: 'PackageEntry', recursionBudget: { maxDepth: 4, depthSize: 'small' } })

export const PackageEntryFieldSchema = S.Union([PackageEntrySchema, S.TaggedStruct('EntryUndeclared', {})])
export type PackageEntryField = typeof PackageEntryFieldSchema.Type

const isJsonList = (json: S.Json): json is S.JsonArray => Array.isArray(json)

const isJsonObject = (json: S.Json): json is S.JsonObject => Predicate.isObject(json)

const entryOf = (json: S.Json): PackageEntry =>
  Match.value(json).pipe(
    Match.when(Predicate.isString, (path): PackageEntry => ({ _tag: 'EntryPath', path })),
    Match.when(Predicate.isNull, (): PackageEntry => ({ _tag: 'EntryNull' })),
    Match.when(
      isJsonList,
      (fallbacks): PackageEntry => ({ _tag: 'EntryFallbacks', fallbacks: fallbacks.map(entryOf) }),
    ),
    Match.when(isJsonObject, (record): PackageEntry => ({
      _tag: 'EntryMap',
      entries: Object.fromEntries(Object.entries(record).map(([key, target]) => [key, entryOf(target)])),
    })),
    Match.orElse((value): PackageEntry => ({ _tag: 'EntryScalar', value })),
  )

const jsonOf = (entry: PackageEntry): S.Json =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
      EntryPath: ({ path }): S.Json => path,
      EntryFallbacks: ({ fallbacks }): S.Json => fallbacks.map(jsonOf),
      EntryMap: ({ entries }): S.Json =>
        Object.fromEntries(Object.entries(entries).map(([key, target]) => [key, jsonOf(target)])),
      EntryNull: (): S.Json => null,
      EntryScalar: ({ value }): S.Json => value,
    }),
  )

const declaredFieldOf = (json: Option.Option<S.Json>): Option.Option<PackageEntryField> =>
  Option.some(Option.match(json, { onNone: (): PackageEntryField => ({ _tag: 'EntryUndeclared' }), onSome: entryOf }))

const declaredJsonOf = (field: Option.Option<PackageEntryField>): Option.Option<S.Json> =>
  Option.flatMap(field, (present) =>
    Match.value(present).pipe(
      Match.tag('EntryUndeclared', () => Option.none<S.Json>()),
      Match.orElse((entry) => Option.some(jsonOf(entry))),
    ))

const PackageEntryFieldFromKey = S.optionalKey(S.Json).pipe(
  S.decodeTo(
    PackageEntryFieldSchema,
    SchemaTransformation.transformOptional({ decode: declaredFieldOf, encode: declaredJsonOf }),
  ),
)

export const PackageManifestSchema = S.Struct({
  exports: PackageEntryFieldFromKey,
  imports: PackageEntryFieldFromKey,
  main: PackageEntryFieldFromKey,
  module: PackageEntryFieldFromKey,
})
export type PackageManifest = typeof PackageManifestSchema.Type

const ModuleSpecifierKindTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ModuleSpecifierKind')
type ModuleSpecifierKindTypeId = typeof ModuleSpecifierKindTypeId

export class ClassifyModuleSpecifierCommand
  extends S.TaggedClass<ClassifyModuleSpecifierCommand, { readonly brand: unique symbol }>()(
    'ClassifyModuleSpecifierCommand',
    {
      specifier: S.String,
      builtins: S.Array(S.String),
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class PathSpecifier
  extends S.TaggedClass<PathSpecifier, { readonly brand: unique symbol }>()('PathSpecifier', { specifier: S.String })
{
  readonly [ModuleSpecifierKindTypeId] = ModuleSpecifierKindTypeId
}

export class SubpathImportSpecifier
  extends S.TaggedClass<SubpathImportSpecifier, { readonly brand: unique symbol }>()('SubpathImportSpecifier', {
    specifier: S.String,
  })
{
  readonly [ModuleSpecifierKindTypeId] = ModuleSpecifierKindTypeId
}

export class BuiltinSpecifier
  extends S.TaggedClass<BuiltinSpecifier, { readonly brand: unique symbol }>()('BuiltinSpecifier', {
    specifier: S.String,
  })
{
  readonly [ModuleSpecifierKindTypeId] = ModuleSpecifierKindTypeId
}

export class PackageSpecifier
  extends S.TaggedClass<PackageSpecifier, { readonly brand: unique symbol }>()('PackageSpecifier', {
    packageName: S.String,
    subpath: S.String,
  })
{
  readonly [ModuleSpecifierKindTypeId] = ModuleSpecifierKindTypeId
}

const SCOPE_PREFIX = '@'

const SPECIFIER_SEPARATOR = '/'

export const packageSpecifierOf = (specifier: string): PackageSpecifier => {
  const segments = specifier.split(SPECIFIER_SEPARATOR)
  const nameSegments = Boolean.match(specifier.startsWith(SCOPE_PREFIX), { onTrue: () => 2, onFalse: () => 1 })
  return PackageSpecifier.make({
    packageName: segments.slice(0, nameSegments).join(SPECIFIER_SEPARATOR),
    subpath: segments.slice(nameSegments).join(SPECIFIER_SEPARATOR),
  })
}

export const ModuleSpecifierKindSchema = S.Union([
  PathSpecifier,
  SubpathImportSpecifier,
  BuiltinSpecifier,
  PackageSpecifier,
])
export type ModuleSpecifierKind = typeof ModuleSpecifierKindSchema.Type

export class PackageExportRequest
  extends S.TaggedClass<PackageExportRequest, { readonly brand: unique symbol }>()('PackageExportRequest', {
    subpath: S.String,
  })
{}

export class PackageImportRequest
  extends S.TaggedClass<PackageImportRequest, { readonly brand: unique symbol }>()('PackageImportRequest', {
    specifier: S.String,
  })
{}

const ManifestTargetTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ManifestTarget')
type ManifestTargetTypeId = typeof ManifestTargetTypeId

export class ManifestTargetCommand
  extends S.TaggedClass<ManifestTargetCommand, { readonly brand: unique symbol }>()('ManifestTargetCommand', {
    manifest: PackageManifestSchema,
    request: S.Union([PackageExportRequest, PackageImportRequest]),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ManifestPathTarget
  extends S.TaggedClass<ManifestPathTarget, { readonly brand: unique symbol }>()('ManifestPathTarget', {
    target: S.String,
  })
{
  readonly [ManifestTargetTypeId] = ManifestTargetTypeId
}

export class ManifestPackageTarget
  extends S.TaggedClass<ManifestPackageTarget, { readonly brand: unique symbol }>()('ManifestPackageTarget', {
    specifier: S.String,
  })
{
  readonly [ManifestTargetTypeId] = ManifestTargetTypeId
}

export class ManifestTargetMissing
  extends S.TaggedClass<ManifestTargetMissing, { readonly brand: unique symbol }>()('ManifestTargetMissing', {})
{
  readonly [ManifestTargetTypeId] = ManifestTargetTypeId
}

export const ManifestTargetSchema = S.Union([ManifestPathTarget, ManifestPackageTarget, ManifestTargetMissing])
export type ManifestTarget = typeof ManifestTargetSchema.Type

export const ScriptLanguageSchema = S.Literals(['js', 'jsx', 'ts', 'tsx'])
export type ScriptLanguage = typeof ScriptLanguageSchema.Type

const ModuleSpecifiersTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ModuleSpecifiers')
type ModuleSpecifiersTypeId = typeof ModuleSpecifiersTypeId

export class ExtractModuleSpecifiersCommand
  extends S.TaggedClass<ExtractModuleSpecifiersCommand, { readonly brand: unique symbol }>()(
    'ExtractModuleSpecifiersCommand',
    { program: S.Json },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ModuleSpecifiersClosed
  extends S.TaggedClass<ModuleSpecifiersClosed, { readonly brand: unique symbol }>()('ModuleSpecifiersClosed', {
    specifiers: S.Array(S.String),
  })
{
  readonly [ModuleSpecifiersTypeId] = ModuleSpecifiersTypeId
}

export class ModuleSpecifiersOpen
  extends S.TaggedClass<ModuleSpecifiersOpen, { readonly brand: unique symbol }>()('ModuleSpecifiersOpen', {
    specifiers: S.Array(S.String),
  })
{
  readonly [ModuleSpecifiersTypeId] = ModuleSpecifiersTypeId
}

export const ModuleSpecifiersSchema = S.Union([ModuleSpecifiersClosed, ModuleSpecifiersOpen])
export type ModuleSpecifiers = typeof ModuleSpecifiersSchema.Type

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const DrawnSubpath = S.Array(S.String).pipe(S.check(S.isMaxLength(4)))

  const segmentOf = (drawn: string): string => drawn.replaceAll(SPECIFIER_SEPARATOR, '')

  const splitsInto = (parsed: PackageSpecifier, packageName: string, subpath: string): boolean =>
    [parsed.packageName === packageName, parsed.subpath === subpath].every((holds) => holds)

  it.prop(
    '∀n_PackageSpecifier_≡NameSegmentsThenSubpathWithAnEmptyRoot',
    { of: [S.String, S.String, DrawnSubpath], subject: packageSpecifierOf },
    (subject, [scope, name, subpathSegments]) => {
      const unscoped = `n${segmentOf(name)}`
      const scoped = `${SCOPE_PREFIX}${segmentOf(scope)}${SPECIFIER_SEPARATOR}${unscoped}`
      const subpath = subpathSegments.join(SPECIFIER_SEPARATOR)
      return [
        splitsInto(subject(unscoped), unscoped, ''),
        splitsInto(subject(`${unscoped}${SPECIFIER_SEPARATOR}${subpath}`), unscoped, subpath),
        splitsInto(subject(scoped), scoped, ''),
        splitsInto(subject(`${scoped}${SPECIFIER_SEPARATOR}${subpath}`), scoped, subpath),
      ].every((holds) => holds)
    },
  )
}
