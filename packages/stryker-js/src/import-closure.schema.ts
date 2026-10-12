import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as S from 'effect/Schema'

const ImportClosureTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/TestFileClosure')
type ImportClosureTypeId = typeof ImportClosureTypeId

export const ImportClosureModuleSchema = S.Struct({
  dependencies: S.Array(S.String),
  open: S.Boolean,
})
export type ImportClosureModule = typeof ImportClosureModuleSchema.Type

export type ImportClosureModuleTable = Readonly<Record<string, ImportClosureModule>>

export class ImportClosureCommand extends S.TaggedClass<ImportClosureCommand>()('ImportClosureCommand', {
  modules: S.Record(S.String, ImportClosureModuleSchema),
  globalInputs: S.Array(S.String),
  testFiles: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class TestFileClosure extends S.TaggedClass<TestFileClosure>()('TestFileClosure', {
  testFile: S.String,
  files: S.Array(S.String),
  open: S.Boolean,
}) {
  readonly [ImportClosureTypeId] = ImportClosureTypeId
}

export const ExportEntrySchema = S.Union([S.String, S.Record(S.String, S.String)])
export type ExportEntry = typeof ExportEntrySchema.Type

export const PackageManifestSchema = S.Struct({
  exports: S.optionalKey(S.Union([S.String, S.Record(S.String, ExportEntrySchema)])),
  imports: S.optionalKey(S.Json),
  main: S.optionalKey(S.String),
  module: S.optionalKey(S.String),
})
export type PackageManifest = typeof PackageManifestSchema.Type

const ModuleSpecifierKindTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ModuleSpecifierKind')
type ModuleSpecifierKindTypeId = typeof ModuleSpecifierKindTypeId

export class ClassifyModuleSpecifierCommand
  extends S.TaggedClass<ClassifyModuleSpecifierCommand>()('ClassifyModuleSpecifierCommand', {
    specifier: S.String,
    builtins: S.Array(S.String),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class PathSpecifier extends S.TaggedClass<PathSpecifier>()('PathSpecifier', { specifier: S.String }) {
  readonly [ModuleSpecifierKindTypeId] = ModuleSpecifierKindTypeId
}

export class SubpathImportSpecifier
  extends S.TaggedClass<SubpathImportSpecifier>()('SubpathImportSpecifier', { specifier: S.String })
{
  readonly [ModuleSpecifierKindTypeId] = ModuleSpecifierKindTypeId
}

export class BuiltinSpecifier extends S.TaggedClass<BuiltinSpecifier>()('BuiltinSpecifier', { specifier: S.String }) {
  readonly [ModuleSpecifierKindTypeId] = ModuleSpecifierKindTypeId
}

export class PackageSpecifier extends S.TaggedClass<PackageSpecifier>()('PackageSpecifier', {
  packageName: S.String,
  subpath: S.String,
}) {
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
  extends S.TaggedClass<PackageExportRequest>()('PackageExportRequest', { subpath: S.String })
{}

export class PackageImportRequest
  extends S.TaggedClass<PackageImportRequest>()('PackageImportRequest', { specifier: S.String })
{}

const ManifestTargetTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ManifestTarget')
type ManifestTargetTypeId = typeof ManifestTargetTypeId

export class ManifestTargetCommand extends S.TaggedClass<ManifestTargetCommand>()('ManifestTargetCommand', {
  manifest: PackageManifestSchema,
  request: S.Union([PackageExportRequest, PackageImportRequest]),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ManifestPathTarget
  extends S.TaggedClass<ManifestPathTarget>()('ManifestPathTarget', { target: S.String })
{
  readonly [ManifestTargetTypeId] = ManifestTargetTypeId
}

export class ManifestPackageTarget
  extends S.TaggedClass<ManifestPackageTarget>()('ManifestPackageTarget', { specifier: S.String })
{
  readonly [ManifestTargetTypeId] = ManifestTargetTypeId
}

export class ManifestTargetMissing extends S.TaggedClass<ManifestTargetMissing>()('ManifestTargetMissing', {}) {
  readonly [ManifestTargetTypeId] = ManifestTargetTypeId
}

export const ManifestTargetSchema = S.Union([ManifestPathTarget, ManifestPackageTarget, ManifestTargetMissing])
export type ManifestTarget = typeof ManifestTargetSchema.Type

export const ScriptLanguageSchema = S.Literals(['js', 'jsx', 'ts', 'tsx'])
export type ScriptLanguage = typeof ScriptLanguageSchema.Type

const ModuleSpecifiersTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ModuleSpecifiers')
type ModuleSpecifiersTypeId = typeof ModuleSpecifiersTypeId

export class ExtractModuleSpecifiersCommand
  extends S.TaggedClass<ExtractModuleSpecifiersCommand>()('ExtractModuleSpecifiersCommand', { program: S.Json })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ModuleSpecifiersClosed extends S.TaggedClass<ModuleSpecifiersClosed>()('ModuleSpecifiersClosed', {
  specifiers: S.Array(S.String),
}) {
  readonly [ModuleSpecifiersTypeId] = ModuleSpecifiersTypeId
}

export class ModuleSpecifiersOpen extends S.TaggedClass<ModuleSpecifiersOpen>()('ModuleSpecifiersOpen', {
  specifiers: S.Array(S.String),
}) {
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
