import { parse } from '@std/jsonc'
import type { Position } from '@systemfsoftware/stryker-js-instrumenter'
import type { CheckerMutantWire, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import * as Predicate from 'effect/Predicate'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { Node, SourceFile } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import type { FileSystem as TSFileSystem } from 'typescript/unstable/fs'
import { API, DiagnosticCategory, type Diagnostic, type Program, type Snapshot } from 'typescript/unstable/sync'

import type { NodeDecodedShape } from './CheckMutants.schema.js'
import { CompilerFailed, type CompilerError, NodeNotInGraph, UnsupportedTypeScriptVersionError } from './Compiler.schema.js'
import { TsConfigNotFoundError, TsConfigParseError, TsConfigSchema, type TsConfig } from './Tsconfig.schema.js'
import {
  getFile,
  make as makeTSFiles,
  mutateFile,
  resetFile,
  setOverrides,
  tsFileSystem,
  type TSFiles,
} from './ts-files.handle.js'

export const TypeId = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TSCompiler')
export type TypeId = typeof TypeId

const RuntimeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TSCompiler/runtime')

const normalizeFileName = (fileName: string) => fileName.replace(/\\/g, '/')

const findSourceMapRegex = /\/\/# sourceMappingURL=(.+)$/m

const getSourceMappingURL = (content: string) => findSourceMapRegex.exec(content)?.[1]

const isString = (value: unknown): value is string => typeof value === 'string'

const isNonEmptyString = (value: string | undefined): value is string => value !== undefined && value !== ''

const relativeSpecifierPattern = /^\.\.?\//

const CLEAN_SPECIFIER_PATTERN = /^["']|["']$/g

const ignoredGraphFileNamePattern = /\.d\.ts$|node_modules/

type FileNode = NodeDecodedShape

type GraphNodes = MutableHashMap.MutableHashMap<string, FileNode>

type SourceFiles = MutableHashMap.MutableHashMap<
  string,
  { fileName: string; imports: MutableHashSet.MutableHashSet<string> }
>

interface CompilerState {
  api: API | undefined
  snapshot: Snapshot | undefined
  sourceFiles: SourceFiles
  nodes: GraphNodes
  lastMutants: CheckerMutantWire[]
  lastMutatedFileNames: string[]
  allTSConfigFiles: MutableHashSet.MutableHashSet<string>
  tsconfigFile: string
}

interface TSCompilerRuntime {
  readonly options: StrykerOptions
  readonly host: FileSystem.FileSystem
  readonly pathService: Path.Path
  readonly files: TSFiles
  readonly sourceFileSystem: TSFileSystem
  readonly state: Ref.Ref<CompilerState>
}

export interface TSCompiler extends Pipeable {
  readonly [TypeId]: TypeId
  readonly [RuntimeTypeId]: TSCompilerRuntime
}

export const isTSCompiler = (u: unknown): u is TSCompiler => Predicate.hasProperty(u, TypeId)

export const make = (
  options: StrykerOptions,
  services: { readonly host: FileSystem.FileSystem; readonly pathService: Path.Path },
): TSCompiler => {
  const files = makeTSFiles(services.host)
  const tsconfigFile = normalizeFileName(options.tsconfigFile)
  const initialState: CompilerState = {
    api: undefined,
    snapshot: undefined,
    sourceFiles: MutableHashMap.empty(),
    nodes: MutableHashMap.empty(),
    lastMutants: [],
    lastMutatedFileNames: [],
    allTSConfigFiles: MutableHashSet.fromIterable([tsconfigFile]),
    tsconfigFile,
  }
  return {
    [TypeId]: TypeId,
    [RuntimeTypeId]: {
      options,
      host: services.host,
      pathService: services.pathService,
      files,
      sourceFileSystem: tsFileSystem(files),
      state: Ref.makeUnsafe(initialState),
    },
    ...Prototype,
  }
}

interface TypeScriptVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

const minimumTypeScriptVersion: TypeScriptVersion = { major: 7, minor: 0, patch: 0 }

const versionComponent = (parts: readonly string[], index: number) => Number.parseInt(parts[index] ?? '0', 10)

const splitVersion = (version: string): TypeScriptVersion => {
  const parts = version.replace(/[-+][\s\S]*$/, '').split('.')
  return {
    major: versionComponent(parts, 0),
    minor: versionComponent(parts, 1),
    patch: versionComponent(parts, 2),
  }
}

const isNewerOrSame = (left: TypeScriptVersion, right: TypeScriptVersion) => {
  const differences = [left.major - right.major, left.minor - right.minor, left.patch - right.patch]
  return (differences.find((difference) => difference !== 0) ?? 0) >= 0
}

const isSupportedTypeScriptVersion = (version: string) => {
  const parsed = splitVersion(version)
  const numeric = [parsed.major, parsed.minor, parsed.patch].every((part) => !Number.isNaN(part))
  return numeric && isNewerOrSame(parsed, minimumTypeScriptVersion)
}

const readTypescriptVersion = (rt: TSCompilerRuntime) =>
  Effect.gen(function*() {
    const packagePath = yield* rt.pathService.fromFileUrl(new URL(import.meta.resolve('typescript/package.json')))
    const text = yield* rt.host.readFileString(packagePath)
    return Result.match(S.decodeResult(S.fromJsonString(S.Struct({ version: S.String })))(text), {
      onFailure: () => '',
      onSuccess: (pkg) => pkg.version,
    })
  }).pipe(Effect.orElseSucceed(() => ''))

const guardTypescriptVersion = (rt: TSCompilerRuntime): Effect.Effect<void, UnsupportedTypeScriptVersionError> =>
  Effect.flatMap(readTypescriptVersion(rt), (version) =>
    Boolean.match(isSupportedTypeScriptVersion(version), {
      onFalse: () => Effect.fail(UnsupportedTypeScriptVersionError.make({ version })),
      onTrue: () => Effect.void,
    }))

type CompilerOptionValue = boolean | string | number | readonly string[] | undefined

const COMPILER_OPTIONS_OVERRIDES: Readonly<Record<string, CompilerOptionValue>> = Object.freeze({
  allowUnreachableCode: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  skipLibCheck: true,
})

const NO_EMIT_OPTIONS_FOR_SINGLE_PROJECT: Readonly<Record<string, CompilerOptionValue>> = Object.freeze({
  noEmit: true,
  incremental: false,
  tsBuildInfoFile: undefined,
  composite: false,
})

const LOW_EMIT_OPTIONS_FOR_PROJECT_REFERENCES: Readonly<Record<string, CompilerOptionValue>> = Object.freeze({
  emitDeclarationOnly: true,
  noEmit: false,
  declarationMap: true,
  declaration: true,
  composite: true,
})

const reasonOfThrown = <A = unknown>(cause: A) =>
  Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse(() => 'a non-Error value was thrown'),
  )

const parseTsConfig = (fileName: string, jsonText: string): Result.Result<TsConfig, TsConfigParseError> =>
  Result.flatMap(
    Result.try({
      try: () => parse(jsonText.replace(/^\uFEFF/, '')),
      catch: (cause) => TsConfigParseError.make({ file: fileName, reason: reasonOfThrown(cause) }),
    }),
    (value) =>
      Result.mapError(
        S.decodeUnknownResult(TsConfigSchema)(value),
        (error) => TsConfigParseError.make({ file: fileName, reason: error.message }),
      ),
  )

const tsconfigDeclaresReferences = (fileName: string, jsonText: string) =>
  Result.match(parseTsConfig(fileName, jsonText), {
    onFailure: () => false,
    onSuccess: (config) => config.references !== undefined,
  })

const withCompilerOverrides = (config: TsConfig, extraOptions: Readonly<Record<string, CompilerOptionValue>>) => ({
  ...config.compilerOptions,
  ...COMPILER_OPTIONS_OVERRIDES,
  ...extraOptions,
})

const projectReferencesJson = (config: TsConfig): string => {
  const compilerOptions = withCompilerOverrides(config, LOW_EMIT_OPTIONS_FOR_PROJECT_REFERENCES)
  delete compilerOptions['inlineSourceMap']
  delete compilerOptions['inlineSources']
  delete compilerOptions['mapRoute']
  delete compilerOptions['sourceRoot']
  delete compilerOptions['outFile']
  return JSON.stringify({ ...config, compilerOptions })
}

const singleProjectJson = (config: TsConfig): string => {
  const compilerOptions = withCompilerOverrides(config, NO_EMIT_OPTIONS_FOR_SINGLE_PROJECT)
  Boolean.match(compilerOptions['declarationDir'] !== null, {
    onTrue: () => {
      delete compilerOptions['declarationDir']
    },
    onFalse: () => undefined,
  })
  const { references: _references, ...withoutReferences } = config
  return JSON.stringify({ ...withoutReferences, compilerOptions })
}

const overrideOptions = (config: TsConfig, buildMode: boolean): string =>
  Boolean.match(buildMode, {
    onTrue: () => projectReferencesJson(config),
    onFalse: () => singleProjectJson(config),
  })

const referencedProjectsOf = (rt: TSCompilerRuntime, config: TsConfig, fromDirName: string): ReadonlyArray<string> =>
  Arr.map(config.references ?? [], (reference) => {
    const resolved = rt.pathService.resolve(fromDirName, reference.path)
    return normalizeFileName(
      Boolean.match(rt.pathService.basename(resolved).endsWith('.json'), {
        onTrue: () => resolved,
        onFalse: () => rt.pathService.join(resolved, 'tsconfig.json'),
      }),
    )
  })

interface TsConfigWalk {
  readonly overrides: MutableHashMap.MutableHashMap<string, string>
  readonly files: MutableHashSet.MutableHashSet<string>
  readonly processed: MutableHashSet.MutableHashSet<string>
}

const recordTsConfig = (
  rt: TSCompilerRuntime,
  buildMode: boolean,
  walk: TsConfigWalk,
  fileName: string,
  jsonText: string,
): TsConfigWalk =>
  Result.match(parseTsConfig(fileName, jsonText), {
    onFailure: () => ({ ...walk, overrides: MutableHashMap.set(walk.overrides, fileName, jsonText) }),
    onSuccess: (config) => ({
      overrides: MutableHashMap.set(walk.overrides, fileName, overrideOptions(config, buildMode)),
      files: Arr.reduce(
        referencedProjectsOf(rt, config, rt.pathService.dirname(fileName)),
        walk.files,
        (files, referenced) => MutableHashSet.add(files, normalizeFileName(referenced)),
      ),
      processed: walk.processed,
    }),
  })

const walkTsConfigs = (
  rt: TSCompilerRuntime,
  buildMode: boolean,
  walk: TsConfigWalk,
  pending: ReadonlyArray<string>,
): Effect.Effect<TsConfigWalk, CompilerError> =>
  Option.match(Option.filter(Arr.last(pending), (fileName) => !MutableHashSet.has(walk.processed, fileName)), {
    onNone: () => Effect.succeed(walk),
    onSome: (fileName) =>
      Effect.flatMap(
        rt.host.readFileString(fileName).pipe(Effect.mapError(() => TsConfigNotFoundError.make({ file: fileName }))),
        (jsonText) =>
          walkTsConfigs(
            rt,
            buildMode,
            recordTsConfig(
              rt,
              buildMode,
              { ...walk, processed: MutableHashSet.add(walk.processed, fileName) },
              fileName,
              jsonText,
            ),
            pending.slice(1),
          ),
      ),
  })

const snapshotOf = (state: CompilerState) =>
  Effect.fromOption(Option.fromUndefinedOr(state.snapshot), () => CompilerFailed.make({ reason: 'not-initialized' }))

const programsOf = (rt: TSCompilerRuntime): Effect.Effect<ReadonlyArray<Program>, CompilerFailed> =>
  Effect.flatMap(Ref.get(rt.state), (state) =>
    Effect.flatMap(snapshotOf(state), (snapshot) => {
      const projects = snapshot.getProjects()
      return Boolean.match(projects.length === 0, {
        onTrue: () => Effect.fail(CompilerFailed.make({ reason: 'no-projects', subject: state.tsconfigFile })),
        onFalse: () => Effect.succeed(Arr.map(projects, (project) => project.program)),
      })
    }))

const resolveFileName = (rt: TSCompilerRuntime, fileName: string) => normalizeFileName(rt.pathService.resolve(fileName))

const applyMutant = (rt: TSCompilerRuntime, mutant: CheckerMutantWire): Effect.Effect<void, CompilerFailed> =>
  Effect.flatMap(getFile(rt.files, resolveFileName(rt, mutant.fileName)), (file) =>
    Effect.flatMap(
      Effect.fromOption(file, () => CompilerFailed.make({ reason: 'file-not-in-project', subject: mutant.fileName })),
      () =>
        Effect.mapError(
          mutateFile(rt.files, resolveFileName(rt, mutant.fileName), mutant),
          () => CompilerFailed.make({ reason: 'file-not-in-project', subject: mutant.fileName }),
        ),
    ))

const applyMutants = (rt: TSCompilerRuntime, mutants: readonly CheckerMutantWire[]) =>
  Effect.forEach(mutants, (mutant) => applyMutant(rt, mutant), { discard: true })

const resetMutatedFiles = (rt: TSCompilerRuntime, mutants: readonly CheckerMutantWire[]) =>
  Effect.forEach(mutants, (mutant) => resetFile(rt.files, resolveFileName(rt, mutant.fileName)), { discard: true })

interface InitializedCompilerState extends CompilerState {
  readonly api: API
  readonly snapshot: Snapshot
}

const hasOpenSnapshot = (state: CompilerState): state is InitializedCompilerState =>
  state.api !== undefined && state.snapshot !== undefined

const updateSnapshot = (
  rt: TSCompilerRuntime,
  initialized: InitializedCompilerState,
  changedFiles: ReadonlyArray<string>,
): Effect.Effect<void> =>
  Effect.gen(function*() {
    const next = initialized.api.updateSnapshot({
      openProjects: Array.from(initialized.allTSConfigFiles),
      fileChanges: { changed: [...changedFiles] },
    })
    yield* Effect.sync(() => initialized.snapshot.dispose())
    yield* Ref.update(rt.state, (prev) => ({ ...prev, snapshot: next }))
  })

const refreshSnapshot = (rt: TSCompilerRuntime, changedFiles: ReadonlyArray<string>): Effect.Effect<void> =>
  Effect.flatMap(Ref.get(rt.state), (current) =>
    Option.match(Option.liftPredicate(current, hasOpenSnapshot), {
      onNone: () => Effect.void,
      onSome: (initialized) => Effect.asVoid(updateSnapshot(rt, initialized, changedFiles)),
    }))

const annotateDiagnosticSample = (diagnostics: readonly Diagnostic[]): Effect.Effect<void> =>
  Boolean.match(diagnostics.length === 0, {
    onTrue: () => Effect.void,
    onFalse: () =>
      Effect.annotateCurrentSpan({
        'typescript.diagnostics.sample': Arr
          .map(
            Arr.take(diagnostics, 10),
            (diagnostic) => diagnostic.fileName + ':' + diagnostic.code + ': ' + diagnostic.text,
          )
          .join('; '),
      }),
  })

const importSpecifierOf = (
  statement: SourceFile['statements'][number],
  sourceFile: SourceFile,
): Option.Option<string> =>
  Boolean.match(statement.kind !== SyntaxKind.ImportDeclaration, {
    onTrue: () => Option.none<string>(),
    onFalse: () => {
      const children: Array<Node> = []
      statement.forEachChild((child) => {
        children.push(child)
      })
      return Option.map(
        Arr.findLast(children, (child) => child.kind === SyntaxKind.StringLiteral),
        (literal) => literal.getText(sourceFile),
      )
    },
  })

const externalSpecifiersOf = (
  statement: SourceFile['statements'][number],
  sourceFile: SourceFile,
): ReadonlyArray<string> => {
  const specifiers: Array<string> = []
  Option.map(
    Option.liftPredicate(statement, (node) => node.kind === SyntaxKind.ImportEqualsDeclaration),
    (declaration) =>
      declaration.forEachChild((child) =>
        child.forEachChild((reference) =>
          Option.map(
            Boolean.match(reference.kind === SyntaxKind.StringLiteral, {
              onTrue: () => Option.some<Node>(reference),
              onFalse: () => Option.none<Node>(),
            }),
            (literal) => {
              specifiers.push(literal.getText(sourceFile))
            },
          ),
        ),
      ),
  )
  return specifiers
}

const keepSome = <A>(option: Option.Option<A>): Result.Result<A, void> =>
  Option.match(option, {
    onNone: () => Result.failVoid,
    onSome: Result.succeed,
  })

const importsOf = (sourceFile: SourceFile): ReadonlyArray<string> => [
  ...Arr.filterMap(sourceFile.statements, (statement) => keepSome(importSpecifierOf(statement, sourceFile))),
  ...Arr.map(sourceFile.referencedFiles, (reference) => reference.fileName),
  ...Arr.map(sourceFile.typeReferenceDirectives, (reference) => reference.fileName),
]

const resolutionCandidates = (rt: TSCompilerRuntime, resolved: string): ReadonlyArray<string> => {
  const extension = rt.pathService.extname(resolved)
  return Boolean.match(extension === '', {
    onTrue: () => [
      resolved,
      resolved + '.ts',
      resolved + '.tsx',
      resolved + '.d.ts',
      resolved + '/index.ts',
      resolved + '/index.tsx',
      resolved + '/index.d.ts',
      resolved + '.js',
      resolved + '.jsx',
      resolved + '.mjs',
      resolved + '.cjs',
      resolved + '/index.js',
      resolved + '/index.jsx',
      resolved + '/index.mjs',
      resolved + '/index.cjs',
    ],
    onFalse: () => {
      const withoutExtension = resolved.slice(0, -extension.length)
      return [
        resolved,
        withoutExtension + '.ts',
        withoutExtension + '.tsx',
        withoutExtension + '.d.ts',
        withoutExtension + '.js',
        withoutExtension + '.jsx',
        withoutExtension + '.mjs',
        withoutExtension + '.cjs',
      ]
    },
  })
}

const resolveSpecifier = (
  rt: TSCompilerRuntime,
  sourceFiles: SourceFiles,
  fileName: string,
  specifier: string,
): Option.Option<string> => {
  const cleaned = specifier.replace(CLEAN_SPECIFIER_PATTERN, '')
  return Boolean.match(relativeSpecifierPattern.test(cleaned), {
    onFalse: () => Option.none<string>(),
    onTrue: () => {
      const resolved = normalizeFileName(rt.pathService.resolve(rt.pathService.dirname(fileName), cleaned))
      return Option.filter(
        Arr.findFirst(resolutionCandidates(rt, resolved), (candidate) => MutableHashMap.has(sourceFiles, candidate)),
        (candidate) => candidate !== '',
      )
    },
  })
}

const readFileText = (rt: TSCompilerRuntime, fileName: string): Option.Option<string> =>
  Option.liftPredicate(rt.sourceFileSystem.readFile?.(fileName), isString)

const onlySourceOf = (sources: readonly string[]): Option.Option<string> =>
  Boolean.match(sources.length !== 1, {
    onTrue: () => Option.none<string>(),
    onFalse: () => Option.fromUndefinedOr(sources[0]),
  })

const sourceMapSourcesOf = (rt: TSCompilerRuntime, content: string): Option.Option<string> =>
  Result.match(S.decodeResult(S.fromJsonString(S.Struct({ sources: S.Array(S.String) })))(content), {
    onFailure: () => Option.none<string>(),
    onSuccess: (map) => onlySourceOf(map.sources),
  })

const sourceMappedFileName = (rt: TSCompilerRuntime, declarationFileName: string): Option.Option<string> =>
  Option.flatMap(
    Option.flatMap(readFileText(rt, declarationFileName), (content) =>
      Option.liftPredicate(getSourceMappingURL(content), isNonEmptyString)),
    (reference) => {
      const sourceMapFileName = normalizeFileName(
        rt.pathService.resolve(rt.pathService.dirname(declarationFileName), reference),
      )
      return Option.flatMap(
        Option.flatMap(readFileText(rt, sourceMapFileName), (content) => sourceMapSourcesOf(rt, content)),
        (source) =>
          Option.some(normalizeFileName(rt.pathService.resolve(rt.pathService.dirname(sourceMapFileName), source))),
      )
    },
  )

const resolveTSInputFile = (rt: TSCompilerRuntime, dependencyFileName: string) =>
  Boolean.match(dependencyFileName.endsWith('.d.ts'), {
    onFalse: () => dependencyFileName,
    onTrue: () => Option.getOrElse(sourceMappedFileName(rt, dependencyFileName), () => dependencyFileName),
  })

const registerGraphFile = (sourceFiles: SourceFiles, fileName: string) =>
  Boolean.match(ignoredGraphFileNamePattern.test(fileName), {
    onTrue: () => undefined,
    onFalse: () => {
      const normalized = normalizeFileName(fileName)
      MutableHashMap.set(sourceFiles, normalized, { fileName: normalized, imports: MutableHashSet.empty<string>() })
    },
  })

const sourceFileOf = (programs: readonly Program[], fileName: string): Option.Option<SourceFile> =>
  Option.flatMap(
    Arr.findFirst(programs, (program) => program.getSourceFile(fileName) !== undefined),
    (program) => Option.fromUndefinedOr(program.getSourceFile(fileName)),
  )

const linkImport = (rt: TSCompilerRuntime, sourceFiles: SourceFiles, fileName: string, specifier: string) =>
  Option.map(
    Option.filter(resolveSpecifier(rt, sourceFiles, fileName, specifier), (resolved) => resolved !== ''),
    (resolved) => {
      const imported = resolveTSInputFile(rt, resolved)
      Boolean.match(MutableHashMap.has(sourceFiles, imported), {
        onFalse: () => undefined,
        onTrue: () => {
          Option.map(MutableHashMap.get(sourceFiles, fileName), (entry) => {
            MutableHashSet.add(entry.imports, imported)
          })
        },
      })
    },
  )

const buildGraph = (rt: TSCompilerRuntime, programs: readonly Program[]) => {
  const state = Ref.getUnsafe(rt.state)
  Arr.forEach(programs, (program) =>
    Arr.forEach(program.getSourceFileNames(), (fileName) => registerGraphFile(state.sourceFiles, fileName)))
  Arr.forEach(Array.from(state.sourceFiles), ([fileName]) => {
    Option.map(sourceFileOf(programs, fileName), (sourceFile) =>
      Arr.forEach(importsOf(sourceFile), (specifier) => linkImport(rt, state.sourceFiles, fileName, specifier)))
  })
}

const parentNodesOf = (node: FileNode, nodes: GraphNodes): ReadonlyArray<FileNode> => {
  const parents: Array<FileNode> = []
  MutableHashMap.forEach(nodes, (candidate) => {
    Boolean.match(candidate.children.includes(node), {
      onTrue: () => {
        parents.push(candidate)
      },
      onFalse: () => undefined,
    })
  })
  return parents
}

const replaceWith = <K, V>(target: MutableHashMap.MutableHashMap<K, V>, source: MutableHashMap.MutableHashMap<K, V>) => {
  MutableHashMap.clear(target)
  MutableHashMap.forEach(source, (value, key) => {
    MutableHashMap.set(target, key, value)
  })
}

const buildFileNodes = (rt: TSCompilerRuntime): Effect.Effect<void, CompilerFailed> =>
  Effect.gen(function*() {
    const state = yield* Ref.get(rt.state)
    Arr.forEach(Array.from(state.sourceFiles), ([fileName]) => {
      MutableHashMap.set(state.nodes, fileName, { children: [], fileName, parents: [] })
    })
    const withChildren = MutableHashMap.empty<string, FileNode>()
    yield* Effect.forEach(
      Array.from(state.sourceFiles),
      ([fileName, file]) => (
        Effect.map(
          Effect.fromOption(
            MutableHashMap.get(state.nodes, fileName),
            () => CompilerFailed.make({ reason: 'unknown-file-node', subject: fileName }),
          ),
          (node) => ({
            ...node,
            parents: [],
            children: Arr.filterMap(Array.from(file.imports), (importName) => keepSome(MutableHashMap.get(state.nodes, importName))),
          })
        )
      ),
      { discard: true },
    )
    replaceWith(state.nodes, withChildren)
    const withParents = MutableHashMap.empty<string, FileNode>()
    MutableHashMap.forEach(state.nodes, (node, fileName) => {
      MutableHashMap.set(withParents, fileName, { ...node, parents: parentNodesOf(node, state.nodes) })
    })
    replaceWith(state.nodes, withParents)
  })

const nodesOf = (rt: TSCompilerRuntime): Effect.Effect<GraphNodes, CompilerFailed> =>
  Effect.flatMap(Ref.get(rt.state), (state) =>
    Effect.as(
      Boolean.match(MutableHashMap.size(state.nodes) > 0, {
        onTrue: () => Effect.void,
        onFalse: () => buildFileNodes(rt),
      }),
      state.nodes,
    ))

interface MutantGroup {
  readonly mutantIds: Array<string>
  readonly nodes: MutableHashSet.MutableHashSet<FileNode>
  readonly ignoredNodes: MutableHashSet.MutableHashSet<FileNode>
}

const collectParentReference = (into: MutableHashSet.MutableHashSet<FileNode>, parent: FileNode) =>
  Boolean.match(MutableHashSet.has(into, parent), {
    onTrue: () => undefined,
    onFalse: () => {
      MutableHashSet.add(into, parent)
      Arr.forEach(parent.parents, (ancestor) => collectParentReference(into, ancestor))
    },
  })

const parentReferencesOf = (node: FileNode): MutableHashSet.MutableHashSet<FileNode> => {
  const references = MutableHashSet.empty<FileNode>()
  MutableHashSet.add(references, node)
  Arr.forEach(node.parents, (parent) => collectParentReference(references, parent))
  return references
}

const joinsGroup = (node: FileNode, group: MutantGroup) =>
  !MutableHashSet.has(group.ignoredNodes, node) &&
  !Arr.some(Array.from(parentReferencesOf(node)), (parent) => MutableHashSet.has(group.nodes, parent))

const nodeOf = (fileName: string, nodes: GraphNodes): Effect.Effect<FileNode, NodeNotInGraph> =>
  Effect.fromOption(
    Option.firstSomeOf([MutableHashMap.get(nodes, normalizeFileName(fileName)), MutableHashMap.get(nodes, fileName)]),
    () => new NodeNotInGraph({ fileName }),
  )

const addToGroup = (
  remaining: MutableHashSet.MutableHashSet<CheckerMutantWire>,
  nodes: GraphNodes,
  group: MutantGroup,
  mutant: CheckerMutantWire,
): Effect.Effect<void, NodeNotInGraph> =>
  Effect.flatMap(nodeOf(mutant.fileName, nodes), (node) =>
    Boolean.match(joinsGroup(node, group), {
      onFalse: () => Effect.void,
      onTrue: () =>
        Effect.sync(() => {
          group.mutantIds.push(mutant.id)
          MutableHashSet.add(group.nodes, node)
          MutableHashSet.remove(remaining, mutant)
          Arr.forEach(Array.from(parentReferencesOf(node)), (parent) => MutableHashSet.add(group.ignoredNodes, parent))
        }),
    }))

const takeIndependentGroup = (
  remaining: MutableHashSet.MutableHashSet<CheckerMutantWire>,
  nodes: GraphNodes,
): Effect.Effect<ReadonlyArray<string>, NodeNotInGraph> => {
  const group: MutantGroup = {
    ignoredNodes: MutableHashSet.empty(),
    mutantIds: [],
    nodes: MutableHashSet.empty(),
  }
  return Effect.as(
    Effect.forEach(Arr.fromIterable(remaining), (mutant) => addToGroup(remaining, nodes, group, mutant), { discard: true }),
    group.mutantIds,
  )
}

const createGroups = (
  mutants: readonly CheckerMutantWire[],
  nodes: GraphNodes,
): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, NodeNotInGraph> => {
  const remaining = MutableHashSet.fromIterable(mutants)
  const groupAll = (groups: ReadonlyArray<ReadonlyArray<string>>): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, NodeNotInGraph> =>
    Boolean.match(MutableHashSet.size(remaining) > 0, {
      onTrue: () => Effect.flatMap(takeIndependentGroup(remaining, nodes), (taken) => groupAll([...groups, taken])),
      onFalse: () => Effect.succeed(groups),
    })
  return groupAll([])
}

const groupMutants = (
  mutants: readonly CheckerMutantWire[],
  nodes: GraphNodes,
  prioritizePerformanceOverAccuracy: boolean,
): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, NodeNotInGraph> =>
  Boolean.match(prioritizePerformanceOverAccuracy, {
    onFalse: () => Effect.succeed(Arr.map(mutants, (mutant) => [mutant.id])),
    onTrue: () => {
      const inside = Arr.filter(mutants, (mutant) =>
        Option.isSome(MutableHashMap.get(nodes, normalizeFileName(mutant.fileName))))
      const outside = Arr.filter(mutants, (mutant) =>
        Option.isNone(MutableHashMap.get(nodes, normalizeFileName(mutant.fileName))))
      return Boolean.match(inside.length === 0, {
        onTrue: () => Effect.succeed(Arr.map(mutants, (mutant) => [mutant.id])),
        onFalse: () =>
          Boolean.match(outside.length === 0, {
            onTrue: () => createGroups(inside, nodes),
            onFalse: () =>
              Effect.map(createGroups(inside, nodes), (created) => [Arr.map(outside, (mutant) => mutant.id), ...created]),
          }),
      })
    },
  })

export const init = (self: TSCompiler): Effect.Effect<readonly Diagnostic[], CompilerError> => {
  const rt = self[RuntimeTypeId]
  return Effect.gen(function*() {
    yield* guardTypescriptVersion(rt)
    const tsconfigFile = normalizeFileName(rt.pathService.resolve(rt.options.tsconfigFile))
    yield* Ref.update(rt.state, (prev) => ({
      ...prev,
      tsconfigFile,
      allTSConfigFiles: MutableHashSet.fromIterable([tsconfigFile]),
    }))
    yield* Effect.flatMap(Ref.get(rt.state), (state) =>
      Effect.asVoid(
        Effect.mapError(
          rt.host.readFileString(state.tsconfigFile),
          () => TsConfigNotFoundError.make({ file: state.tsconfigFile }),
        ),
      ))
    const buildMode = yield* Effect.map(
      Effect.option(rt.host.readFileString(tsconfigFile)),
      (jsonText) => tsconfigDeclaresReferences(tsconfigFile, Option.getOrElse(jsonText, () => '')),
    )
    const walk = yield* walkTsConfigs(
      rt,
      buildMode,
      {
        files: MutableHashSet.fromIterable([tsconfigFile]),
        overrides: MutableHashMap.empty(),
        processed: MutableHashSet.empty(),
      },
      [tsconfigFile],
    )
    yield* setOverrides(rt.files, walk.overrides)
    yield* Ref.update(rt.state, (prev) => ({ ...prev, allTSConfigFiles: walk.files }))
    const api = new API({ fs: rt.sourceFileSystem })
    const snapshot = api.updateSnapshot({ openProjects: Array.from(walk.files) })
    yield* Ref.update(rt.state, (prev) => ({ ...prev, api, snapshot }))
    buildGraph(rt, yield* programsOf(rt))
    return yield* check(self, [])
  })
}

export const check: {
  (mutants: readonly CheckerMutantWire[]): (self: TSCompiler) => Effect.Effect<readonly Diagnostic[], CompilerError>
  (self: TSCompiler, mutants: readonly CheckerMutantWire[]): Effect.Effect<readonly Diagnostic[], CompilerError>
} = dual(
  2,
  (self: TSCompiler, mutants: readonly CheckerMutantWire[]): Effect.Effect<readonly Diagnostic[], CompilerError> => {
    const rt = self[RuntimeTypeId]
    return Effect.gen(function*() {
      const state = yield* Ref.get(rt.state)
      yield* resetMutatedFiles(rt, state.lastMutants)
      yield* applyMutants(rt, mutants)
      const mutatedFileNames = Array.from(
        MutableHashSet.fromIterable(Arr.map(mutants, (mutant) => resolveFileName(rt, mutant.fileName))),
      )
      const changedFiles = Array.from(
        MutableHashSet.fromIterable([...state.lastMutatedFileNames, ...mutatedFileNames]),
      )
      yield* refreshSnapshot(rt, changedFiles)
      yield* Ref.update(rt.state, (prev) => ({
        ...prev,
        lastMutants: [...mutants],
        lastMutatedFileNames: mutatedFileNames,
      }))
      const programs = yield* programsOf(rt)
      const diagnostics = Arr.filter(
        Arr.flatMap(programs, (program) => [
          ...program.getConfigFileParsingDiagnostics(),
          ...program.getSemanticDiagnostics(),
          ...program.getProgramDiagnostics(),
        ]),
        (diagnostic) => diagnostic.category === DiagnosticCategory.Error,
      )
      yield* Effect.annotateCurrentSpan({ 'typescript.diagnostics.count': diagnostics.length })
      yield* annotateDiagnosticSample(diagnostics)
      return diagnostics
    }).pipe(
      Effect.withSpan('typescript-checker.compiler.check', {
        attributes: {
          'stryker.mutants.count': mutants.length,
          'stryker.mutants.ids': Arr.map(mutants, (mutant) => mutant.id).join(','),
        },
      }),
    )
  },
)

export const nodes = (self: TSCompiler): Effect.Effect<GraphNodes, CompilerError> => nodesOf(self[RuntimeTypeId])

export const groups: {
  (
    mutants: readonly CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): (self: TSCompiler) => Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError | NodeNotInGraph>
  (
    self: TSCompiler,
    mutants: readonly CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError | NodeNotInGraph>
} = dual(
  3,
  (
    self: TSCompiler,
    mutants: readonly CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError | NodeNotInGraph> =>
    Effect.flatMap(nodes(self), (graphNodes) => groupMutants(mutants, graphNodes, prioritizePerformanceOverAccuracy)),
)

export const getLineAndCharacterOfPosition: {
  (fileName: string, position: number): (self: TSCompiler) => Effect.Effect<{ line: number; character: number } | undefined>
  (
    self: TSCompiler,
    fileName: string,
    position: number,
  ): Effect.Effect<{ line: number; character: number } | undefined>
} = dual(
  3,
  (
    self: TSCompiler,
    fileName: string,
    position: number,
  ): Effect.Effect<{ line: number; character: number } | undefined> =>
    Effect.map(
      Effect.orElseSucceed(programsOf(self[RuntimeTypeId]), (): ReadonlyArray<Program> => []),
      (programs) =>
        Option.getOrUndefined(
          Option.map(
            Arr.head(Arr.filterMap(programs, (program) => keepSome(Option.fromUndefinedOr(program.getSourceFile(fileName))))),
            (found) => found.getLineAndCharacterOfPosition(position),
          ),
        ),
    ),
)

export const close = (self: TSCompiler): Effect.Effect<void> => {
  const rt = self[RuntimeTypeId]
  return Effect.gen(function*() {
    const state = yield* Ref.get(rt.state)
    yield* Effect.sync(() => state.snapshot?.dispose())
    yield* Effect.sync(() => state.api?.close())
    yield* Ref.update(rt.state, (prev) => ({ ...prev, snapshot: undefined, api: undefined }))
  })
}
