/// <reference types="vitest/importMeta" />
import { parse } from '@std/jsonc'
import { Checker, type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
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
import { API, type Diagnostic, DiagnosticCategory, type Program, type Snapshot } from 'typescript/unstable/async'
import type { FileSystem as TSFileSystem } from 'typescript/unstable/fs'

import type { NodeDecodedShape } from './CheckMutants.schema.js'
import {
  type CompilerError,
  CompilerFailed,
  NodeNotInGraph,
  UnsupportedTypeScriptVersionError,
} from './Compiler.schema.js'
import {
  getFile,
  make as makeTSFiles,
  mutateFile,
  resetFile,
  setOverrides,
  type TSFiles,
  tsFileSystem,
} from './ts-files.handle.js'
import { type TsConfig, TsConfigNotFoundError, TsConfigParseError, TsConfigSchema } from './Tsconfig.schema.js'

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

type GraphNodes = HashMap.HashMap<string, FileNode>

type SourceFiles = MutableHashMap.MutableHashMap<
  string,
  { fileName: string; imports: MutableHashSet.MutableHashSet<string> }
>

interface CompilerState {
  api: API | undefined
  snapshot: Snapshot | undefined
  sourceFiles: SourceFiles
  nodes: GraphNodes
  lastMutants: Checker.CheckerMutantWire[]
  lastMutatedFileNames: string[]
  allTSConfigFiles: MutableHashSet.MutableHashSet<string>
  tsconfigFile: string
}

interface TSCompilerRuntime {
  readonly options: Options.StrykerOptions
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

export const make: {
  (
    options: Options.StrykerOptions,
    services: { readonly host: FileSystem.FileSystem; readonly pathService: Path.Path },
  ): TSCompiler
  (
    services: { readonly host: FileSystem.FileSystem; readonly pathService: Path.Path },
  ): (options: Options.StrykerOptions) => TSCompiler
} = dual(
  2,
  (
    options: Options.StrykerOptions,
    services: { readonly host: FileSystem.FileSystem; readonly pathService: Path.Path },
  ): TSCompiler => {
    const files = makeTSFiles(services.host)
    const tsconfigFile = normalizeFileName(options.tsconfigFile)
    const initialState: CompilerState = {
      api: undefined,
      snapshot: undefined,
      sourceFiles: MutableHashMap.empty(),
      nodes: HashMap.empty(),
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
  },
)

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
      Option.match(Option.liftPredicate(value, S.is(TsConfigSchema)), {
        onSome: (original) => Result.succeed(original),
        onNone: () =>
          Result.mapError(
            S.decodeUnknownResult(TsConfigSchema)(value),
            (error) => TsConfigParseError.make({ file: fileName, reason: error.message }),
          ),
      }),
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

const enqueueUnseen = (walk: TsConfigWalk, pending: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.reduce(
    Arr.fromIterable(walk.files),
    pending,
    (queued, fileName) =>
      Boolean.match(
        MutableHashSet.has(walk.processed, fileName) || queued.includes(fileName),
        { onTrue: () => queued, onFalse: () => [...queued, fileName] },
      ),
  )

const walkTsConfigs = (
  rt: TSCompilerRuntime,
  buildMode: boolean,
  walk: TsConfigWalk,
  pending: ReadonlyArray<string>,
): Effect.Effect<TsConfigWalk, CompilerError> =>
  Option.match(Option.filter(Arr.head(pending), (fileName) => !MutableHashSet.has(walk.processed, fileName)), {
    onNone: () => Effect.succeed(walk),
    onSome: (fileName) =>
      Effect.flatMap(
        rt.host.readFileString(fileName).pipe(Effect.mapError(() => TsConfigNotFoundError.make({ file: fileName }))),
        (jsonText) => {
          const recorded = recordTsConfig(
            rt,
            buildMode,
            { ...walk, processed: MutableHashSet.add(walk.processed, fileName) },
            fileName,
            jsonText,
          )
          return walkTsConfigs(rt, buildMode, recorded, enqueueUnseen(recorded, pending.slice(1)))
        },
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

const applyMutant = (rt: TSCompilerRuntime, mutant: Checker.CheckerMutantWire): Effect.Effect<void, CompilerFailed> =>
  Effect.flatMap(getFile(rt.files, resolveFileName(rt, mutant.fileName)), (file) =>
    Effect.flatMap(
      Effect.fromOption(file, () => CompilerFailed.make({ reason: 'file-not-in-project', subject: mutant.fileName })),
      () =>
        Effect.mapError(
          mutateFile(rt.files, resolveFileName(rt, mutant.fileName), mutant),
          () => CompilerFailed.make({ reason: 'file-not-in-project', subject: mutant.fileName }),
        ),
    ))

const applyMutants = (rt: TSCompilerRuntime, mutants: readonly Checker.CheckerMutantWire[]) =>
  Effect.forEach(mutants, (mutant) => applyMutant(rt, mutant), { discard: true })

const resetMutatedFiles = (rt: TSCompilerRuntime, mutants: readonly Checker.CheckerMutantWire[]) =>
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
    const next = yield* Effect.promise(() =>
      initialized.api.updateSnapshot({
        openProjects: Array.from(initialized.allTSConfigFiles),
        fileChanges: { changed: [...changedFiles] },
      })
    )
    yield* Effect.promise(() => initialized.snapshot.dispose())
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
    Option.flatMap(
      readFileText(rt, declarationFileName),
      (content) => Option.liftPredicate(getSourceMappingURL(content), isNonEmptyString),
    ),
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

const sourceFileIn = (program: Program, fileName: string): Effect.Effect<Option.Option<SourceFile>> =>
  Effect.map(Effect.promise(() => program.getSourceFile(fileName)), (found) => Option.fromUndefinedOr(found))

const sourceFileOf = (
  programs: readonly Program[],
  fileName: string,
): Effect.Effect<Option.Option<SourceFile>> =>
  Option.match(Arr.head(programs), {
    onNone: () => Effect.succeed(Option.none<SourceFile>()),
    onSome: (program) =>
      Effect.filterOrElse(
        sourceFileIn(program, fileName),
        Option.isSome,
        () => sourceFileOf(Arr.drop(programs, 1), fileName),
      ),
  })

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

const buildGraph = (rt: TSCompilerRuntime, programs: readonly Program[]): Effect.Effect<void> =>
  Effect.gen(function*() {
    const state = Ref.getUnsafe(rt.state)
    yield* Effect.forEach(
      programs,
      (program) =>
        Effect.map(
          Effect.promise(() => program.getSourceFileNames()),
          (fileNames) => Arr.forEach(fileNames, (fileName) => registerGraphFile(state.sourceFiles, fileName)),
        ),
      { discard: true },
    )
    yield* Effect.forEach(
      Array.from(state.sourceFiles),
      ([fileName]) =>
        Effect.map(
          sourceFileOf(programs, fileName),
          (found) =>
            Option.map(found, (sourceFile) =>
              Arr.forEach(importsOf(sourceFile), (specifier) =>
                linkImport(rt, state.sourceFiles, fileName, specifier))),
        ),
      { discard: true },
    )
  })

const fileNode = (fileName: string, children: ReadonlyArray<FileNode>): FileNode => ({
  children,
  fileName,
  parents: [],
})

const graphNodesOf = (sourceFiles: SourceFiles): GraphNodes => {
  const entries = Arr.fromIterable(sourceFiles)
  const leaves = HashMap.fromIterable(
    Arr.map(entries, ([fileName]): readonly [string, FileNode] => [fileName, fileNode(fileName, [])]),
  )
  return HashMap.fromIterable(
    Arr.map(entries, ([fileName, file]): readonly [string, FileNode] => [
      fileName,
      fileNode(
        fileName,
        Arr.filterMap(Arr.fromIterable(file.imports), (imported) => keepSome(HashMap.get(leaves, imported))),
      ),
    ]),
  )
}

const nodesOf = (rt: TSCompilerRuntime) =>
  Effect.flatMap(Ref.get(rt.state), (state) =>
    Boolean.match(HashMap.isEmpty(state.nodes), {
      onFalse: () => Effect.succeed(state.nodes),
      onTrue: () => {
        const nodes = graphNodesOf(state.sourceFiles)
        return Effect.as(Ref.update(rt.state, (prev) => ({ ...prev, nodes })), nodes)
      },
    }))

const ancestorFileNamesOf = (node: FileNode, visited: HashSet.HashSet<string>): HashSet.HashSet<string> =>
  Boolean.match(HashSet.has(visited, node.fileName), {
    onTrue: () => visited,
    onFalse: () =>
      Arr.reduce(
        node.parents,
        HashSet.add(visited, node.fileName),
        (names, parent) => ancestorFileNamesOf(parent, names),
      ),
  })

const nodeOf = (fileName: string, nodes: GraphNodes): Result.Result<FileNode, NodeNotInGraph> =>
  Result.fromOption(
    Option.firstSomeOf([HashMap.get(nodes, normalizeFileName(fileName)), HashMap.get(nodes, fileName)]),
    () => NodeNotInGraph.make({ fileName }),
  )

interface MutantRound {
  readonly ids: ReadonlyArray<string>
  readonly members: HashSet.HashSet<string>
  readonly ignored: HashSet.HashSet<string>
  readonly taken: HashSet.HashSet<Checker.CheckerMutantWire>
}

const emptyRound: MutantRound = {
  ids: [],
  ignored: HashSet.empty(),
  members: HashSet.empty(),
  taken: HashSet.empty(),
}

const sharesDependencyPath = (node: FileNode, round: MutantRound): boolean =>
  HashSet.has(round.ignored, node.fileName) ||
  Arr.some(Arr.fromIterable(ancestorFileNamesOf(node, HashSet.empty())), (name) => HashSet.has(round.members, name))

const joinRound = (round: MutantRound, mutant: Checker.CheckerMutantWire, node: FileNode): MutantRound =>
  Boolean.match(sharesDependencyPath(node, round), {
    onFalse: () => ({
      ids: [...round.ids, mutant.id],
      ignored: HashSet.union(round.ignored, ancestorFileNamesOf(node, HashSet.empty())),
      members: HashSet.add(round.members, node.fileName),
      taken: HashSet.add(round.taken, mutant),
    }),
    onTrue: () => round,
  })

const takeRound = (
  remaining: ReadonlyArray<Checker.CheckerMutantWire>,
  nodes: GraphNodes,
): Result.Result<MutantRound, NodeNotInGraph> =>
  Arr.reduce(
    remaining,
    Result.succeed(emptyRound),
    (round, mutant): Result.Result<MutantRound, NodeNotInGraph> =>
      Result.flatMap(
        round,
        (current) => Result.map(nodeOf(mutant.fileName, nodes), (node) => joinRound(current, mutant, node)),
      ),
  )

interface Grouping {
  readonly groups: ReadonlyArray<ReadonlyArray<string>>
  readonly remaining: ReadonlyArray<Checker.CheckerMutantWire>
}

const emptyGrouping = (remaining: ReadonlyArray<Checker.CheckerMutantWire>): Grouping => ({ groups: [], remaining })

const takeNextRound = (nodes: GraphNodes) => (grouping: Grouping) =>
  Boolean.match(grouping.remaining.length === 0, {
    onTrue: () => Result.succeed(grouping),
    onFalse: () =>
      Result.map(takeRound(grouping.remaining, nodes), (round) => ({
        groups: [...grouping.groups, round.ids],
        remaining: Arr.filter(grouping.remaining, (mutant) => !HashSet.has(round.taken, mutant)),
      })),
  })

const roundsOf = (inside: ReadonlyArray<Checker.CheckerMutantWire>, nodes: GraphNodes) => {
  const pending = Arr.dedupe(inside)
  return Result.map(
    Arr.reduce(
      pending,
      Result.succeed(emptyGrouping(pending)),
      (grouping, _mutant): Result.Result<Grouping, NodeNotInGraph> => Result.flatMap(grouping, takeNextRound(nodes)),
    ),
    (grouping) => grouping.groups,
  )
}

const groupMutants = (
  mutants: readonly Checker.CheckerMutantWire[],
  nodes: GraphNodes,
  prioritizePerformanceOverAccuracy: boolean,
) =>
  Boolean.match(prioritizePerformanceOverAccuracy, {
    onFalse: () => Result.succeed(Arr.map(mutants, (mutant) => [mutant.id])),
    onTrue: () => {
      const inside = Arr.filter(mutants, (mutant) =>
        Option.isSome(HashMap.get(nodes, normalizeFileName(mutant.fileName))))
      const outside = Arr.filter(mutants, (mutant) =>
        Option.isNone(HashMap.get(nodes, normalizeFileName(mutant.fileName))))
      return Boolean.match(inside.length === 0, {
        onTrue: () =>
          Result.succeed(Arr.map(mutants, (mutant) => [mutant.id])),
        onFalse: () =>
          Result.map(roundsOf(inside, nodes), (created) =>
            Boolean.match(outside.length === 0, {
              onTrue: () =>
                created,
              onFalse: () => [
                Arr.map(outside, (mutant) =>
                  mutant.id),
                ...created,
              ],
            })),
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
    const snapshot = yield* Effect.promise(() => api.updateSnapshot({ openProjects: Array.from(walk.files) }))
    yield* Ref.update(rt.state, (prev) => ({ ...prev, api, snapshot }))
    yield* buildGraph(rt, yield* programsOf(rt))
    return yield* check(self, [])
  })
}

const diagnosticsOf = (program: Program): Effect.Effect<readonly Diagnostic[]> =>
  Effect.promise(() =>
    Promise.all([
      program.getConfigFileParsingDiagnostics(),
      program.getSemanticDiagnostics(),
      program.getProgramDiagnostics(),
    ]).then(([config, semantic, programWide]) => [...config, ...semantic, ...programWide])
  )

export const check: {
  (
    mutants: readonly Checker.CheckerMutantWire[],
  ): (self: TSCompiler) => Effect.Effect<readonly Diagnostic[], CompilerError>
  (self: TSCompiler, mutants: readonly Checker.CheckerMutantWire[]): Effect.Effect<readonly Diagnostic[], CompilerError>
} = dual(
  2,
  (
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
  ): Effect.Effect<readonly Diagnostic[], CompilerError> => {
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
        Arr.flatten(yield* Effect.forEach(programs, (program) => diagnosticsOf(program))),
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

export const nodes = (self: TSCompiler) => nodesOf(self[RuntimeTypeId])

export const groups: {
  (
    mutants: readonly Checker.CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): (self: TSCompiler) => Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError | NodeNotInGraph>
  (
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError | NodeNotInGraph>
} = dual(
  3,
  (
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError | NodeNotInGraph> =>
    Effect.flatMap(
      nodes(self),
      (graphNodes) => Effect.fromResult(groupMutants(mutants, graphNodes, prioritizePerformanceOverAccuracy)),
    ),
)

export const getLineAndCharacterOfPosition: {
  (
    fileName: string,
    position: number,
  ): (self: TSCompiler) => Effect.Effect<{ line: number; character: number } | undefined>
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
    Effect.flatMap(
      Effect.orElseSucceed(programsOf(self[RuntimeTypeId]), (): ReadonlyArray<Program> => []),
      (programs) =>
        Effect.map(
          sourceFileOf(programs, fileName),
          (found) =>
            Option.getOrUndefined(
              Option.map(found, (sourceFile) => sourceFile.getLineAndCharacterOfPosition(position)),
            ),
        ),
    ),
)

export const close = (self: TSCompiler): Effect.Effect<void> => {
  const rt = self[RuntimeTypeId]
  return Effect.gen(function*() {
    const state = yield* Ref.get(rt.state)
    yield* Effect.promise(() => Promise.resolve(state.snapshot?.dispose()))
    yield* Effect.promise(() => Promise.resolve(state.api?.close()))
    yield* Ref.update(rt.state, (prev) => ({ ...prev, snapshot: undefined, api: undefined }))
  })
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const Equal = await import('effect/Equal')
  const { Mutant: { CanonicalFileName, MutantId, MutatorName } } = await import(
    '@systemfsoftware/stryker-js-instrumenter'
  )

  const FILE_INDEX_LIMIT = 4

  const IndexSchema = S.Int.check(S.isBetween({ minimum: 0, maximum: FILE_INDEX_LIMIT }))
  const EdgesSchema = S.Array(S.Tuple([IndexSchema, IndexSchema])).check(S.isMaxLength(6))
  const MutantsSchema = S.Array(IndexSchema).check(S.isMaxLength(6))

  const fileNameOf = (index: number) => `src/file-${index}.ts`
  const linkedNode = (fileName: string, parents: ReadonlyArray<FileNode>): FileNode => ({
    children: [],
    fileName,
    parents,
  })

  const graphOfEdges = (edges: ReadonlyArray<readonly [number, number]>): GraphNodes => {
    const size = 1 + Arr.reduce(edges, 0, (largest, [child, parent]) => Math.max(largest, child, parent))
    const leaves = HashMap.fromIterable(
      Arr.map(Arr.range(0, size - 1), (index): readonly [string, FileNode] => [
        fileNameOf(index),
        linkedNode(fileNameOf(index), []),
      ]),
    )
    return HashMap.fromIterable(
      Arr.map(Arr.range(0, size - 1), (index): readonly [string, FileNode] => [
        fileNameOf(index),
        linkedNode(
          fileNameOf(index),
          Arr.filterMap(
            Arr.filter(edges, ([child]) => child === index),
            ([, parent]) => keepSome(HashMap.get(leaves, fileNameOf(parent))),
          ),
        ),
      ]),
    )
  }

  const mutantWireOf = (id: string, fileName: string): Checker.CheckerMutantWire =>
    Checker.CheckerMutantWire.make({
      id: MutantId.make(id),
      fileName: CanonicalFileName.make(fileName),
      mutatorName: MutatorName.make('foo-mutator'),
      replacement: 'x',
      location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    })

  const mutantsOf = (fileIndexes: readonly number[]) =>
    Arr.map(fileIndexes, (index, position) => mutantWireOf(`mutant-${position}`, fileNameOf(index)))

  const groupedOf = (mutants: ReadonlyArray<Checker.CheckerMutantWire>, nodes: GraphNodes, prioritize: boolean) =>
    Result.getOrElse(groupMutants(mutants, nodes, prioritize), () => [])

  const relatedNodes = (left: FileNode, right: FileNode): boolean =>
    HashSet.has(ancestorFileNamesOf(left, HashSet.empty()), right.fileName) ||
    HashSet.has(ancestorFileNamesOf(right, HashSet.empty()), left.fileName)

  interface Assignment {
    readonly ids: ReadonlyArray<string>
    readonly members: ReadonlyArray<FileNode>
  }

  const noAssignments: ReadonlyArray<Assignment> = []

  const firstFitGrouping = (
    mutants: ReadonlyArray<Checker.CheckerMutantWire>,
    nodes: GraphNodes,
    prioritize: boolean,
  ) =>
    Boolean.match(prioritize, {
      onFalse: () => Arr.map(mutants, (mutant) => [mutant.id]),
      onTrue: () => {
        const inside = Arr.filter(
          mutants,
          (mutant) => Option.isSome(HashMap.get(nodes, normalizeFileName(mutant.fileName))),
        )
        const outside = Arr.filter(
          mutants,
          (mutant) => Option.isNone(HashMap.get(nodes, normalizeFileName(mutant.fileName))),
        )
        return Boolean.match(inside.length === 0, {
          onTrue: () => Arr.map(mutants, (mutant) => [mutant.id]),
          onFalse: () => {
            const assignments = Arr.reduce(
              Arr.filterMap(
                inside,
                (mutant) =>
                  Result.map(keepSome(HashMap.get(nodes, normalizeFileName(mutant.fileName))), (node) => ({
                    id: mutant.id,
                    node,
                  })),
              ),
              noAssignments,
              (groups, candidate) =>
                Option.match(
                  Arr.findFirstIndex(
                    groups,
                    (group) => !Arr.some(group.members, (member) => relatedNodes(member, candidate.node)),
                  ),
                  {
                    onSome: (index) =>
                      Arr.map(groups, (group, at) =>
                        Boolean.match(at === index, {
                          onTrue: () => ({
                            ids: [...group.ids, candidate.id],
                            members: [...group.members, candidate.node],
                          }),
                          onFalse: () => group,
                        })),
                    onNone: () => [...groups, { ids: [candidate.id], members: [candidate.node] }],
                  },
                ),
            )
            const ids = Arr.map(assignments, (group) => group.ids)
            return Boolean.match(outside.length === 0, {
              onTrue: () => ids,
              onFalse: () => [Arr.map(outside, (mutant) => mutant.id), ...ids],
            })
          },
        })
      },
    })

  it.prop(
    '∀graph_Mutants_≡ReferenceFirstFit',
    [EdgesSchema, MutantsSchema, S.Boolean],
    ([edges, fileIndexes, prioritize]) => {
      const nodes = graphOfEdges(edges)
      const mutants = mutantsOf(fileIndexes)
      return Result.match(groupMutants(mutants, nodes, prioritize), {
        onFailure: () => false,
        onSuccess: (grouped) => Equal.equals(grouped, firstFitGrouping(mutants, nodes, prioritize)),
      })
    },
  )

  it.prop('∀graph_Mutants_≡Partition', [EdgesSchema, MutantsSchema, S.Boolean], ([edges, fileIndexes, prioritize]) => {
    const nodes = graphOfEdges(edges)
    const mutants = mutantsOf(fileIndexes)
    const placed = Arr.flatten(groupedOf(mutants, nodes, prioritize))
    const expected = Arr.map(mutants, (mutant) => mutant.id)
    return Arr.every(
      [
        placed.length === mutants.length,
        HashSet.size(HashSet.fromIterable(placed)) === mutants.length,
        HashSet.size(HashSet.fromIterable([...placed, ...expected])) === mutants.length,
      ],
      (holds) => holds,
    )
  })

  it.prop('∀graph_Group_≈Independent', [EdgesSchema, MutantsSchema], ([edges, fileIndexes]) => {
    const nodes = graphOfEdges(edges)
    const mutants = mutantsOf(fileIndexes)
    const byId = HashMap.fromIterable(
      Arr.map(mutants, (mutant): readonly [string, Checker.CheckerMutantWire] => [mutant.id, mutant]),
    )
    const pairs = Arr.flatMap(groupedOf(mutants, nodes, true), (ids) => {
      const members = Arr.filterMap(
        ids,
        (id) =>
          keepSome(
            Option.flatMap(HashMap.get(byId, id), (mutant) => HashMap.get(nodes, normalizeFileName(mutant.fileName))),
          ),
      )
      return Arr.flatMap(
        members,
        (left, index) => Arr.map(Arr.drop(members, index + 1), (right): readonly [FileNode, FileNode] => [left, right]),
      )
    })
    return Arr.every(pairs, ([left, right]) => !relatedNodes(left, right))
  })

  const { expect } = await import('vitest')
  const { Arbitrary } = await import('effect/unstable/arbitrary')

  type JsonValue = string | boolean | number | null | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue }
  type JsonTsConfig = { readonly [key: string]: JsonValue | undefined }

  const SafeKey = S.String.check(S.isPattern(/^[A-Za-z$_][A-Za-z0-9$_-]*$/))

  const JsonValueSchema: S.Schema<JsonValue> = S.Union([
    S.String,
    S.Boolean,
    S.Null,
    S.Int,
    S.Array(S.suspend((): S.Schema<JsonValue> => JsonValueSchema)),
    S.Record(SafeKey, S.suspend((): S.Schema<JsonValue> => JsonValueSchema)),
  ])

  const JsonRecordSchema = S.Record(SafeKey, JsonValueSchema)

  const KnownTsConfigFields = S.Struct({
    extends: S.optional(S.Union([S.String, S.Array(S.String)])),
    include: S.Array(S.String).pipe(S.optional),
    exclude: S.Array(S.String).pipe(S.optional),
    watchOptions: S.optional(JsonRecordSchema),
    typeAcquisition: S.optional(JsonRecordSchema),
    references: S.Struct({ path: S.String }).pipe(S.Array, S.optional),
    compilerOptions: S.optional(JsonRecordSchema),
  })

  const knownTsConfigKeys = [
    'extends',
    'include',
    'exclude',
    'files',
    'watchOptions',
    'typeAcquisition',
    'references',
    'compilerOptions',
  ]

  const TsConfigLike = Arbitrary.all([
    Arbitrary.schema(KnownTsConfigFields),
    Arbitrary.schema(JsonRecordSchema),
  ]).pipe(
    Arbitrary.map(([known, extra]): JsonTsConfig => ({
      ...Object.fromEntries(Object.entries(known).filter(([, value]) => value !== undefined)),
      ...Object.fromEntries(Object.entries(extra).filter(([key]) => !knownTsConfigKeys.includes(key))),
    })),
  )

  const omitCompilerOptions = (value: JsonTsConfig): JsonTsConfig => {
    const { compilerOptions: _dropped, ...rest } = value
    return rest
  }

  const omitReferences = (value: JsonTsConfig): JsonTsConfig => {
    const { references: _dropped, ...rest } = value
    return rest
  }

  const buildTouchedOptions = [
    ...Object.keys(COMPILER_OPTIONS_OVERRIDES),
    ...Object.keys(LOW_EMIT_OPTIONS_FOR_PROJECT_REFERENCES),
    'inlineSourceMap',
    'inlineSources',
    'mapRoute',
    'sourceRoot',
    'outFile',
  ]

  const singleTouchedOptions = [
    ...Object.keys(COMPILER_OPTIONS_OVERRIDES),
    ...Object.keys(NO_EMIT_OPTIONS_FOR_SINGLE_PROJECT),
    'declarationDir',
  ]

  const isNotNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

  const isJsonObject = (value: unknown): value is JsonTsConfig => isNotNullObject(value) && !Array.isArray(value)

  const compilerOptionsOf = (config: JsonTsConfig): JsonTsConfig | undefined => {
    const compilerOptions = config['compilerOptions']
    return isJsonObject(compilerOptions) ? compilerOptions : undefined
  }

  const entryUntouched = (
    output: JsonTsConfig,
    touched: ReadonlyArray<string>,
    entry: readonly [string, JsonValue | undefined],
  ): boolean => touched.includes(entry[0]) || Equal.equals(output[entry[0]], entry[1])

  const sourceEntriesOf = (source: JsonTsConfig | undefined): ReadonlyArray<readonly [string, JsonValue | undefined]> =>
    Object.entries(source ?? {})

  const untouchedCompilerOptionsPreserved = (
    source: JsonTsConfig | undefined,
    output: JsonTsConfig | undefined,
    touched: ReadonlyArray<string>,
  ): boolean => {
    const target: JsonTsConfig = output ?? {}
    return sourceEntriesOf(source).every((entry) => entryUntouched(target, touched, entry))
  }

  const overriddenOptionOf = (config: JsonTsConfig, key: string): JsonValue | undefined =>
    compilerOptionsOf(config)?.[key]

  const parsedOverrideOf = (text: string): Option.Option<JsonTsConfig> =>
    Option.liftPredicate(JSON.parse(text), isJsonObject)

  it.prop(
    '∀tsconfig_Override_≡OriginalExceptDeliberateCompilerOverrides',
    [TsConfigLike],
    ([original]) =>
      Result.match(parseTsConfig('tsconfig.json', JSON.stringify(original)), {
        onFailure: () => false,
        onSuccess: (config) =>
          Option.match(
            Option.all([
              parsedOverrideOf(overrideOptions(config, true)),
              parsedOverrideOf(overrideOptions(config, false)),
            ]),
            {
              onNone: () => false,
              onSome: ([build, single]) =>
                Arr.every(
                  [
                    Equal.equals(omitCompilerOptions(build), omitCompilerOptions(original)),
                    Equal.equals(omitCompilerOptions(single), omitReferences(omitCompilerOptions(original))),
                    untouchedCompilerOptionsPreserved(
                      compilerOptionsOf(original),
                      compilerOptionsOf(build),
                      buildTouchedOptions,
                    ),
                    untouchedCompilerOptionsPreserved(
                      compilerOptionsOf(original),
                      compilerOptionsOf(single),
                      singleTouchedOptions,
                    ),
                    overriddenOptionOf(build, 'emitDeclarationOnly') === true,
                    overriddenOptionOf(build, 'noEmit') === false,
                    overriddenOptionOf(single, 'noEmit') === true,
                    overriddenOptionOf(single, 'incremental') === false,
                  ],
                  (holds) => holds,
                ),
            },
          ),
      }),
  )

  const refusedAsParseError = (jsonText: string): boolean =>
    Result.match(parseTsConfig('tsconfig.json', jsonText), {
      onFailure: (error) => S.is(TsConfigParseError)(error),
      onSuccess: () => false,
    })

  it('parseTsConfig keeps refusing malformed tsconfig documents', () => {
    const malformed: ReadonlyArray<readonly [label: string, jsonText: string]> = [
      ['root is a string', '"not an object"'],
      ['root is a number', '42'],
      ['root is null', 'null'],
      ['root is an array', '[]'],
      ['references is a string', '{"references": "./lib"}'],
      ['a references item lacks path', '{"references": [{}]}'],
      ['a references item path is a number', '{"references": [{"path": 1}]}'],
      ['compilerOptions is a number', '{"compilerOptions": 42}'],
      ['compilerOptions is an array', '{"compilerOptions": []}'],
      ['the document is not JSON', '{'],
    ]
    for (const [label, jsonText] of malformed) {
      expect(refusedAsParseError(jsonText), label).toBe(true)
    }
    expect(
      Result.isSuccess(parseTsConfig('tsconfig.json', '{"include":["src"],"extends":"./base.json"}')),
      'a document with only preserved keys still parses',
    ).toBe(true)
  })
}
