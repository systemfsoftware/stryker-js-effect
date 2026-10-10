import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BuiltinSpecifier,
  ClassifyModuleSpecifierCommand,
  type ModuleSpecifierKind,
  ModuleSpecifierKindSchema,
  PackageSpecifier,
  PathSpecifier,
  SubpathImportSpecifier,
} from './import-closure.schema.js'

const PATH_PREFIXES: readonly string[] = ['.', '/']

const SUBPATH_IMPORT_PREFIX = '#'

const NODE_SCHEME_PREFIX = 'node:'

const SCOPE_PREFIX = '@'

const isPathSpecifier = (specifier: string): boolean => PATH_PREFIXES.some((prefix) => specifier.startsWith(prefix))

const isSubpathImport = (specifier: string): boolean => specifier.startsWith(SUBPATH_IMPORT_PREFIX)

const isBuiltin = (builtins: readonly string[]) => (specifier: string): boolean =>
  [specifier.startsWith(NODE_SCHEME_PREFIX), builtins.includes(specifier)].some((flag) => flag)

const packageNameOf = (specifier: string): string => {
  const segments = specifier.split('/')
  return Boolean.match(specifier.startsWith(SCOPE_PREFIX), {
    onTrue: () => segments.slice(0, 2).join('/'),
    onFalse: () => Option.getOrElse(Arr.head(segments), () => ''),
  })
}

const packageOf = (specifier: string): ModuleSpecifierKind => {
  const packageName = packageNameOf(specifier)
  return PackageSpecifier.make({ packageName, subpath: specifier.slice(packageName.length + 1) })
}

const kindOf = (command: ClassifyModuleSpecifierCommand): ModuleSpecifierKind =>
  Match.value(command.specifier).pipe(
    Match.when(isPathSpecifier, (specifier): ModuleSpecifierKind => PathSpecifier.make({ specifier })),
    Match.when(isSubpathImport, (specifier): ModuleSpecifierKind => SubpathImportSpecifier.make({ specifier })),
    Match.when(isBuiltin(command.builtins), (specifier): ModuleSpecifierKind => BuiltinSpecifier.make({ specifier })),
    Match.orElse(packageOf),
  )

const decide = (command: ClassifyModuleSpecifierCommand): Result.Result<ModuleSpecifierKind, never> =>
  Result.succeed(kindOf(command))

export const classifyModuleSpecifier = Workflow.make({
  command: ClassifyModuleSpecifierCommand,
  decision: ModuleSpecifierKindSchema,
  error: S.Never,
  decide,
})
