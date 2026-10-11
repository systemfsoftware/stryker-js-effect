import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BuiltinSpecifier,
  ClassifyModuleSpecifierCommand,
  type ModuleSpecifierKind,
  ModuleSpecifierKindSchema,
  packageSpecifierOf,
  PathSpecifier,
  SubpathImportSpecifier,
} from './import-closure.schema.js'

const PATH_PREFIXES: readonly string[] = ['.', '/']

const SUBPATH_IMPORT_PREFIX = '#'

const NODE_SCHEME_PREFIX = 'node:'

const isPathSpecifier = (specifier: string): boolean => PATH_PREFIXES.some((prefix) => specifier.startsWith(prefix))

const isSubpathImport = (specifier: string): boolean => specifier.startsWith(SUBPATH_IMPORT_PREFIX)

const isBuiltin = (builtins: readonly string[]) => (specifier: string): boolean =>
  [specifier.startsWith(NODE_SCHEME_PREFIX), builtins.includes(specifier)].some((flag) => flag)

const kindOf = (command: ClassifyModuleSpecifierCommand): ModuleSpecifierKind =>
  Match.value(command.specifier).pipe(
    Match.when(isPathSpecifier, (specifier): ModuleSpecifierKind => PathSpecifier.make({ specifier })),
    Match.when(isSubpathImport, (specifier): ModuleSpecifierKind => SubpathImportSpecifier.make({ specifier })),
    Match.when(isBuiltin(command.builtins), (specifier): ModuleSpecifierKind => BuiltinSpecifier.make({ specifier })),
    Match.orElse((specifier): ModuleSpecifierKind => packageSpecifierOf(specifier)),
  )

const decide = (command: ClassifyModuleSpecifierCommand): Result.Result<ModuleSpecifierKind, never> =>
  Result.succeed(kindOf(command))

export const classifyModuleSpecifier = Workflow.make({
  command: ClassifyModuleSpecifierCommand,
  decision: ModuleSpecifierKindSchema,
  error: S.Never,
  decide,
})
