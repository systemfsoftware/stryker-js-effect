import { Workflow } from '@systemfsoftware/effect-cell-types'
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
  main: S.optionalKey(S.String),
  module: S.optionalKey(S.String),
})
export type PackageManifest = typeof PackageManifestSchema.Type

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
