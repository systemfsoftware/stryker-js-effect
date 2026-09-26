import { Handle } from '@systemfsoftware/effect-cell-types'
import { Checker, type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SynchronizedRef from 'effect/SynchronizedRef'
import type { Node, SourceFile } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import { API, type Diagnostic, DiagnosticCategory, type Program, type Snapshot } from 'typescript/unstable/async'
import type { FileSystem as TSFileSystem } from 'typescript/unstable/fs'

import { captureAliasSpecifier } from './capture-alias-specifier.workflow.js'
import {
  CaptureAliasSpecifierCommand,
  GroupMutantsCommand,
  OverrideTsconfigOptionsCommand,
  ParseTsconfigTextCommand,
  PlanDiagnosticBatchesCommand,
  PlanResolutionCandidatesCommand,
  RequestAffectedFilesCommand,
  TraceAffectedFilesCommand,
} from './CheckerCommands.schema.js'
import type { NodeDecodedShape } from './CheckMutants.schema.js'
import { type CompilerError, CompilerFailed, UnsupportedTypeScriptVersionError } from './Compiler.schema.js'
import { groupMutants } from './group-mutants.workflow.js'
import { overrideTsconfigOptions } from './override-tsconfig-options.workflow.js'
import { parseTsconfigText } from './parse-tsconfig-text.workflow.js'
import { planDiagnosticBatches } from './plan-diagnostic-batches.workflow.js'
import { planResolutionCandidates } from './plan-resolution-candidates.workflow.js'
import { requestAffectedFiles } from './request-affected-files.workflow.js'
import { traceAffectedFiles } from './trace-affected-files.workflow.js'
import {
  getFile,
  make as makeTSFiles,
  mutateFile,
  resetFile,
  setOverrides,
  type TSFiles,
  tsFileSystem,
} from './ts-files.handle.js'
import {
  PathAliasesSchema,
  type TsConfigCompilerOptions,
  TsConfigCompilerOptionsSchema,
  type TsConfigDocument,
  TsConfigNotFoundError,
  TsConfigParseError,
} from './Tsconfig.schema.js'

export const TypeId = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TSCompiler')
export type TypeId = typeof TypeId

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

interface SourceFileEntry {
  readonly fileName: string
  readonly imports: HashSet.HashSet<string>
}

type SourceFiles = HashMap.HashMap<string, SourceFileEntry>

interface CompilerState {
  readonly api: API | undefined
  readonly snapshot: Snapshot | undefined
  readonly sourceFiles: SourceFiles
  readonly nodes: GraphNodes
  readonly lastMutants: ReadonlyArray<Checker.CheckerMutantWire>
  readonly lastMutatedFileNames: ReadonlyArray<string>
  readonly allTSConfigFiles: HashSet.HashSet<string>
  readonly aliases: ReadonlyArray<PathAlias>
  readonly tsconfigFile: string
}

interface TSCompilerRuntime {
  readonly options: Options.StrykerOptions
  readonly host: FileSystem.FileSystem
  readonly pathService: Path.Path
  readonly files: TSFiles
  readonly sourceFileSystem: TSFileSystem
  readonly state: SynchronizedRef.SynchronizedRef<CompilerState>
}

const TSCompiler = Handle.make<object, TSCompilerRuntime>()(TypeId)

export type TSCompiler = Handle.Of<typeof TSCompiler>

export const isTSCompiler = TSCompiler.is

const runtimeOf = (self: TSCompiler): TSCompilerRuntime => TSCompiler.slot(self)

const decided = <A>(result: Result.Result<A, never>): A =>
  Result.match(result, { onFailure: (refused) => refused, onSuccess: (decision) => decision })

export const make: {
  (
    options: Options.StrykerOptions,
    services: { readonly host: FileSystem.FileSystem; readonly pathService: Path.Path },
  ): Effect.Effect<TSCompiler>
  (
    services: { readonly host: FileSystem.FileSystem; readonly pathService: Path.Path },
  ): (options: Options.StrykerOptions) => Effect.Effect<TSCompiler>
} = dual(
  2,
  Effect.fn('typescript-checker.compiler.make')(function*(
    options: Options.StrykerOptions,
    services: { readonly host: FileSystem.FileSystem; readonly pathService: Path.Path },
  ) {
    const files = makeTSFiles(services.host)
    const tsconfigFile = normalizeFileName(options.tsconfigFile)
    const state = yield* SynchronizedRef.make<CompilerState>({
      api: undefined,
      snapshot: undefined,
      sourceFiles: HashMap.empty(),
      nodes: HashMap.empty(),
      lastMutants: [],
      lastMutatedFileNames: [],
      aliases: [],
      allTSConfigFiles: HashSet.fromIterable([tsconfigFile]),
      tsconfigFile,
    })
    return TSCompiler.make({}, {
      options,
      host: services.host,
      pathService: services.pathService,
      files,
      sourceFileSystem: tsFileSystem(files),
      state,
    })
  }),
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

const readTypescriptVersion = Effect.fnUntraced(function*(rt: TSCompilerRuntime) {
  const packagePath = yield* rt.pathService.fromFileUrl(new URL(import.meta.resolve('typescript/package.json')))
  const text = yield* rt.host.readFileString(packagePath)
  return Result.match(S.decodeResult(S.fromJsonString(S.Struct({ version: S.String })))(text), {
    onFailure: () => '',
    onSuccess: (pkg) => pkg.version,
  })
})

const guardTypescriptVersion = (rt: TSCompilerRuntime): Effect.Effect<void, UnsupportedTypeScriptVersionError> =>
  Effect.flatMap(
    readTypescriptVersion(rt).pipe(Effect.orElseSucceed(() => '')),
    (version) =>
      Boolean.match(isSupportedTypeScriptVersion(version), {
        onFalse: () => Effect.fail(UnsupportedTypeScriptVersionError.make({ version })),
        onTrue: () => Effect.void,
      }),
  )

const parseTsConfig = (
  fileName: string,
  jsonText: string,
): Result.Result<TsConfigDocument, TsConfigParseError> =>
  parseTsconfigText(ParseTsconfigTextCommand.make({ text: jsonText })).pipe(
    decided,
    Match.value,
    Match.tag('TsconfigParsed', ({ document }) => Result.succeed(document)),
    Match.tag('TsconfigRefused', ({ reason }) => Result.fail(TsConfigParseError.make({ file: fileName, reason }))),
    Match.exhaustive,
  )

const tsconfigDeclaresReferences = (fileName: string, jsonText: string) =>
  Result.match(parseTsConfig(fileName, jsonText), {
    onFailure: () => false,
    onSuccess: (config) => config['references'] !== undefined,
  })

const overrideTextOf = (document: OverrideTsconfigOptionsCommand['document'], buildMode: boolean): string =>
  decided(overrideTsconfigOptions(OverrideTsconfigOptionsCommand.make({ document, buildMode }))).text

const tsConfigReferencesOf = (config: TsConfigDocument): ReadonlyArray<{ readonly path: string }> =>
  Option.getOrElse(
    Option.liftPredicate(config['references'], S.is(S.Array(S.Struct({ path: S.String })))),
    (): ReadonlyArray<{ readonly path: string }> => [],
  )

const referencedProjectsOf = (
  rt: TSCompilerRuntime,
  config: TsConfigDocument,
  fromDirName: string,
): ReadonlyArray<string> =>
  Arr.map(tsConfigReferencesOf(config), (reference) => {
    const resolved = rt.pathService.resolve(fromDirName, reference.path)
    return normalizeFileName(
      Boolean.match(rt.pathService.basename(resolved).endsWith('.json'), {
        onTrue: () => resolved,
        onFalse: () => rt.pathService.join(resolved, 'tsconfig.json'),
      }),
    )
  })

interface TsConfigWalk {
  readonly overrides: HashMap.HashMap<string, string>
  readonly files: HashSet.HashSet<string>
  readonly processed: HashSet.HashSet<string>
  readonly aliases: ReadonlyArray<PathAlias>
}

const compilerOptionsOf = (config: TsConfigDocument): TsConfigCompilerOptions =>
  Option.getOrElse(
    Option.liftPredicate(config['compilerOptions'], S.is(TsConfigCompilerOptionsSchema)),
    (): TsConfigCompilerOptions => ({}),
  )

const aliasEntriesOf = (
  compilerOptions: TsConfigCompilerOptions,
): ReadonlyArray<readonly [string, ReadonlyArray<string>]> =>
  Object.entries(
    Option.getOrElse(
      S.decodeUnknownOption(PathAliasesSchema)(compilerOptions['paths']),
      (): S.Schema.Type<typeof PathAliasesSchema> => ({}),
    ),
  )

const pathAliasesOf = (
  pathService: Path.Path,
  fileName: string,
  config: TsConfigDocument,
): ReadonlyArray<PathAlias> =>
  aliasEntriesOf(compilerOptionsOf(config)).map(([pattern, targets]): PathAlias => ({
    pattern,
    targets,
    baseDir: pathService.dirname(fileName),
  }))

const recordTsConfig = (
  rt: TSCompilerRuntime,
  buildMode: boolean,
  walk: TsConfigWalk,
  fileName: string,
  jsonText: string,
): TsConfigWalk =>
  Result.match(parseTsConfig(fileName, jsonText), {
    onFailure: () => ({ ...walk, overrides: HashMap.set(walk.overrides, fileName, jsonText) }),
    onSuccess: (config) => ({
      overrides: HashMap.set(walk.overrides, fileName, overrideTextOf(config, buildMode)),
      aliases: [...walk.aliases, ...pathAliasesOf(rt.pathService, fileName, config)],
      files: Arr.reduce(
        referencedProjectsOf(rt, config, rt.pathService.dirname(fileName)),
        walk.files,
        (files, referenced) => HashSet.add(files, normalizeFileName(referenced)),
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
        HashSet.has(walk.processed, fileName) || queued.includes(fileName),
        { onTrue: () => queued, onFalse: () => [...queued, fileName] },
      ),
  )

const readTsConfigText = (
  rt: TSCompilerRuntime,
  preRead: HashMap.HashMap<string, string>,
  fileName: string,
): Effect.Effect<string, TsConfigNotFoundError> =>
  Option.match(HashMap.get(preRead, fileName), {
    onNone: () =>
      rt.host.readFileString(fileName).pipe(Effect.mapError(() => TsConfigNotFoundError.make({ file: fileName }))),
    onSome: (jsonText) => Effect.succeed(jsonText),
  })

const walkTsConfigs = (
  rt: TSCompilerRuntime,
  buildMode: boolean,
  walk: TsConfigWalk,
  pending: ReadonlyArray<string>,
  preRead: HashMap.HashMap<string, string>,
): Effect.Effect<TsConfigWalk, CompilerError> =>
  Option.match(Option.filter(Arr.head(pending), (fileName) => !HashSet.has(walk.processed, fileName)), {
    onNone: () => Effect.succeed(walk),
    onSome: (fileName) =>
      Effect.flatMap(readTsConfigText(rt, preRead, fileName), (jsonText) => {
        const recorded = recordTsConfig(
          rt,
          buildMode,
          { ...walk, processed: HashSet.add(walk.processed, fileName) },
          fileName,
          jsonText,
        )
        return walkTsConfigs(rt, buildMode, recorded, enqueueUnseen(recorded, pending.slice(1)), preRead)
      }),
  })

const snapshotOf = (state: CompilerState) =>
  Effect.fromOption(Option.fromUndefinedOr(state.snapshot), () => CompilerFailed.make({ reason: 'not-initialized' }))

const programsOf = (rt: TSCompilerRuntime): Effect.Effect<ReadonlyArray<Program>, CompilerFailed> =>
  Effect.flatMap(SynchronizedRef.get(rt.state), (state) =>
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

const updateSnapshot = Effect.fnUntraced(function*(
  rt: TSCompilerRuntime,
  initialized: InitializedCompilerState,
  changedFiles: ReadonlyArray<string>,
) {
  const next = yield* Effect.promise(() =>
    initialized.api.updateSnapshot({
      openProjects: Array.from(initialized.allTSConfigFiles),
      fileChanges: { changed: [...changedFiles] },
    })
  )
  yield* Effect.promise(() => initialized.snapshot.dispose())
  yield* SynchronizedRef.update(rt.state, (prev) => ({ ...prev, snapshot: next }))
})

const refreshSnapshot = (rt: TSCompilerRuntime, changedFiles: ReadonlyArray<string>): Effect.Effect<void> =>
  Effect.flatMap(
    SynchronizedRef.get(rt.state),
    (current) =>
      Option.match(Option.liftPredicate(current, hasOpenSnapshot), {
        onNone: () => Effect.void,
        onSome: (initialized) => updateSnapshot(rt, initialized, changedFiles),
      }),
  )

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

const carriesModuleSpecifier = (statement: SourceFile['statements'][number]): boolean =>
  statement.kind === SyntaxKind.ImportDeclaration || statement.kind === SyntaxKind.ExportDeclaration

const moduleSpecifierOf = (
  statement: SourceFile['statements'][number],
  sourceFile: SourceFile,
): Option.Option<string> =>
  Boolean.match(carriesModuleSpecifier(statement), {
    onTrue: () => {
      const children: Array<Node> = []
      statement.forEachChild((child) => {
        children.push(child)
      })
      return Option.map(
        Arr.findLast(children, (child) => child.kind === SyntaxKind.StringLiteral),
        (literal) => literal.getText(sourceFile),
      )
    },
    onFalse: () => Option.none<string>(),
  })

const keepSome = <A>(option: Option.Option<A>): Result.Result<A, void> =>
  Option.match(option, {
    onNone: () => Result.failVoid,
    onSome: Result.succeed,
  })

const importsOf = (sourceFile: SourceFile): ReadonlyArray<string> => [
  ...Arr.filterMap(sourceFile.statements, (statement) => keepSome(moduleSpecifierOf(statement, sourceFile))),
  ...Arr.map(sourceFile.referencedFiles, (reference) => reference.fileName),
  ...Arr.map(sourceFile.typeReferenceDirectives, (reference) => reference.fileName),
]

interface PathAlias {
  readonly pattern: string
  readonly targets: ReadonlyArray<string>
  readonly baseDir: string
}

const aliasTargetPaths = (
  pathService: Path.Path,
  aliases: ReadonlyArray<PathAlias>,
  specifier: string,
): ReadonlyArray<string> =>
  Arr.flatMap(aliases, (alias) => {
    const command = CaptureAliasSpecifierCommand.make({ pattern: alias.pattern, specifier })
    const decision = decided(captureAliasSpecifier(command))
    return Match.value(decision).pipe(
      Match.tag('AliasSpecifierCaptured', ({ capture }) =>
        Arr.map(
          alias.targets,
          (target) => normalizeFileName(pathService.resolve(alias.baseDir, target.replace('*', capture))),
        )),
      Match.tag('AliasSpecifierUnmatched', (): ReadonlyArray<string> => []),
      Match.exhaustive,
    )
  })

const candidatePathsOf = (pathService: Path.Path, resolved: string): ReadonlyArray<string> => {
  const command = PlanResolutionCandidatesCommand.make({ resolved, extension: pathService.extname(resolved) })
  const decision = decided(planResolutionCandidates(command))
  return Match.value(decision).pipe(
    Match.tag('ExtensionNamedPath', ({ candidates }) => candidates),
    Match.tag('ExtensionlessPath', ({ candidates }) => candidates),
    Match.exhaustive,
  )
}

const existingCandidateOf = (
  pathService: Path.Path,
  sourceFiles: SourceFiles,
  resolved: string,
): Option.Option<string> =>
  Arr.findFirst(candidatePathsOf(pathService, resolved), (candidate) => HashMap.has(sourceFiles, candidate))

const resolveAliasedSpecifier = (
  pathService: Path.Path,
  aliases: ReadonlyArray<PathAlias>,
  sourceFiles: SourceFiles,
  specifier: string,
): Option.Option<string> =>
  Option.firstSomeOf(
    Arr.map(aliasTargetPaths(pathService, aliases, specifier), (target) =>
      existingCandidateOf(pathService, sourceFiles, target)),
  )

const resolveSpecifier = (
  pathService: Path.Path,
  aliases: ReadonlyArray<PathAlias>,
  sourceFiles: SourceFiles,
  fileName: string,
  specifier: string,
): Option.Option<string> => {
  const cleaned = specifier.replace(CLEAN_SPECIFIER_PATTERN, '')
  return Boolean.match(relativeSpecifierPattern.test(cleaned), {
    onFalse: () => resolveAliasedSpecifier(pathService, aliases, sourceFiles, cleaned),
    onTrue: () =>
      Option.filter(
        existingCandidateOf(
          pathService,
          sourceFiles,
          normalizeFileName(pathService.resolve(pathService.dirname(fileName), cleaned)),
        ),
        (candidate) => candidate !== '',
      ),
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

const registeredEntry = (fileName: string): Option.Option<readonly [string, SourceFileEntry]> =>
  Boolean.match(ignoredGraphFileNamePattern.test(fileName), {
    onTrue: () => Option.none(),
    onFalse: () => {
      const normalized = normalizeFileName(fileName)
      return Option.some([normalized, { fileName: normalized, imports: HashSet.empty<string>() }] as const)
    },
  })

const registerOwners = (
  owners: HashMap.HashMap<string, Program>,
  program: Program,
  fileNames: ReadonlyArray<string>,
): HashMap.HashMap<string, Program> =>
  Arr.reduce(fileNames, owners, (accumulated, fileName) => {
    const normalized = normalizeFileName(fileName)
    return Boolean.match(HashMap.has(accumulated, normalized), {
      onTrue: () => accumulated,
      onFalse: () => HashMap.set(accumulated, normalized, program),
    })
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

const linkImport = (
  rt: TSCompilerRuntime,
  aliases: ReadonlyArray<PathAlias>,
  sourceFiles: SourceFiles,
  fileName: string,
  specifier: string,
): SourceFiles =>
  Option.match(
    Option.filter(resolveSpecifier(rt.pathService, aliases, sourceFiles, fileName, specifier), (resolved) =>
      resolved !== ''),
    {
      onNone: () =>
        sourceFiles,
      onSome: (resolved) => {
        const imported = resolveTSInputFile(rt, resolved)
        return Boolean.match(HashMap.has(sourceFiles, imported), {
          onFalse: () => sourceFiles,
          onTrue: () =>
            Option.match(HashMap.get(sourceFiles, fileName), {
              onNone: () => sourceFiles,
              onSome: (entry) =>
                HashMap.set(sourceFiles, fileName, {
                  ...entry,
                  imports: HashSet.add(entry.imports, imported),
                }),
            }),
        })
      },
    },
  )

const ownedSourceFileOf = (
  owners: HashMap.HashMap<string, Program>,
  programs: readonly Program[],
  fileName: string,
): Effect.Effect<Option.Option<SourceFile>> =>
  Option.match(HashMap.get(owners, fileName), {
    onNone: () => sourceFileOf(programs, fileName),
    onSome: (owner) =>
      Effect.filterOrElse(sourceFileIn(owner, fileName), Option.isSome, () => sourceFileOf(programs, fileName)),
  })

const buildGraph = Effect.fnUntraced(function*(rt: TSCompilerRuntime, programs: readonly Program[]) {
  const state = yield* SynchronizedRef.get(rt.state)
  const owners = yield* Effect.reduce(
    programs,
    () => HashMap.empty<string, Program>(),
    (accumulated, program) =>
      Effect.map(
        Effect.promise(() => program.getSourceFileNames()),
        (fileNames) => registerOwners(accumulated, program, fileNames),
      ),
  )
  const registered = owners.pipe(
    Arr.fromIterable,
    Arr.filterMap(([fileName]) => keepSome(registeredEntry(fileName))),
    HashMap.fromIterable,
  )
  const linked = yield* Effect.reduce(
    Arr.fromIterable(registered),
    () => registered,
    (sourceFiles, [fileName]) =>
      Effect.map(
        ownedSourceFileOf(owners, programs, fileName),
        (found) =>
          Option.match(found, {
            onNone: () => sourceFiles,
            onSome: (sourceFile) =>
              Arr.reduce(
                importsOf(sourceFile),
                sourceFiles,
                (accumulated, specifier) => linkImport(rt, state.aliases, accumulated, fileName, specifier),
              ),
          }),
      ),
  )
  yield* SynchronizedRef.update(rt.state, (prev) => ({ ...prev, sourceFiles: linked }))
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
  Effect.flatMap(SynchronizedRef.get(rt.state), (state) =>
    Boolean.match(HashMap.isEmpty(state.nodes), {
      onFalse: () => Effect.succeed(state.nodes),
      onTrue: () => {
        const nodes = graphNodesOf(state.sourceFiles)
        return Effect.as(SynchronizedRef.update(rt.state, (prev) => ({ ...prev, nodes })), nodes)
      },
    }))

export const init = Effect.fn('typescript-checker.compiler.init')(function*(
  self: TSCompiler,
): Effect.fn.Return<readonly Diagnostic[], CompilerError> {
  const rt = runtimeOf(self)
  yield* guardTypescriptVersion(rt)
  const tsconfigFile = normalizeFileName(rt.pathService.resolve(rt.options.tsconfigFile))
  yield* SynchronizedRef.update(rt.state, (prev) => ({
    ...prev,
    tsconfigFile,
    allTSConfigFiles: HashSet.fromIterable([tsconfigFile]),
  }))
  const tsconfigText = yield* Effect.mapError(
    rt.host.readFileString(tsconfigFile),
    () => TsConfigNotFoundError.make({ file: tsconfigFile }),
  )
  const buildMode = tsconfigDeclaresReferences(tsconfigFile, tsconfigText)
  const walk = yield* walkTsConfigs(
    rt,
    buildMode,
    {
      files: HashSet.fromIterable([tsconfigFile]),
      overrides: HashMap.empty(),
      processed: HashSet.empty(),
      aliases: [],
    },
    [tsconfigFile],
    HashMap.fromIterable([[tsconfigFile, tsconfigText] as const]),
  )
  yield* setOverrides(rt.files, walk.overrides)
  yield* SynchronizedRef.update(rt.state, (prev) => ({
    ...prev,
    allTSConfigFiles: walk.files,
    aliases: walk.aliases,
  }))
  const api = new API({ fs: rt.sourceFileSystem })
  const snapshot = yield* Effect.promise(() => api.updateSnapshot({ openProjects: Array.from(walk.files) }))
  yield* SynchronizedRef.update(rt.state, (prev) => ({ ...prev, api, snapshot }))
  const programs = yield* programsOf(rt)
  yield* buildGraph(rt, programs)
  return yield* dryRunDiagnostics(programs)
})

const semanticDiagnosticsOf = Effect.fnUntraced(function*(
  program: Program,
  affectedFileNames: HashSet.HashSet<string>,
): Effect.fn.Return<readonly Diagnostic[]> {
  const presentFileNames = yield* Effect.promise(() => program.getSourceFileNames())
  const request = RequestAffectedFilesCommand.make({
    affectedFileNames: Arr.fromIterable(affectedFileNames),
    presentFileNames: [...presentFileNames],
  })
  const requested = decided(requestAffectedFiles(request))
  const batchPlan = PlanDiagnosticBatchesCommand.make({
    fileNames: Match.value(requested).pipe(
      Match.tag(
        'AffectedFilesRequested',
        ({ fileNames }): ReadonlyArray<string> => fileNames,
      ),
      Match.tag('NoAffectedFileRequested', (): ReadonlyArray<string> => []),
      Match.exhaustive,
    ),
  })
  const batches = decided(planDiagnosticBatches(batchPlan))
  const plannedBatches = Match.value(batches).pipe(
    Match.tag('DiagnosticBatchesPlanned', ({ batches }): ReadonlyArray<ReadonlyArray<string>> => batches),
    Match.tag('NoDiagnosticBatches', (): ReadonlyArray<ReadonlyArray<string>> => []),
    Match.exhaustive,
  )
  const perBatch = yield* Effect.forEach(
    plannedBatches,
    (batch) =>
      Effect.map(
        Effect.promise(() => Promise.all(Arr.map(batch, (fileName) => program.getSemanticDiagnostics(fileName)))),
        (perFile) => Arr.flatten(perFile),
      ),
    { concurrency: 1 },
  )
  return [...perBatch].flat()
})

const programWideDiagnosticsOf = (program: Program): Effect.Effect<readonly Diagnostic[]> =>
  Effect.map(
    Effect.promise(() => Promise.all([program.getConfigFileParsingDiagnostics(), program.getProgramDiagnostics()])),
    ([config, programWide]) => [...config, ...programWide],
  )

const affectedDiagnosticsOf = (
  program: Program,
  fileNames: HashSet.HashSet<string>,
): Effect.Effect<readonly Diagnostic[]> =>
  Effect.all([programWideDiagnosticsOf(program), semanticDiagnosticsOf(program, fileNames)], { concurrency: 2 }).pipe(
    Effect.map(([programWide, semantic]) => [...semantic, ...programWide]),
  )

const wholeProgramDiagnosticsOf = (program: Program): Effect.Effect<readonly Diagnostic[]> =>
  Effect.all(
    [programWideDiagnosticsOf(program), Effect.promise(() => program.getSemanticDiagnostics())],
    { concurrency: 2 },
  ).pipe(Effect.map(([programWide, semantic]) => [...semantic, ...programWide]))

const dryRunDiagnostics = Effect.fn('typescript-checker.compiler.dryRun')(function*(
  programs: ReadonlyArray<Program>,
) {
  yield* Effect.annotateCurrentSpan({ 'typescript.projects.count': programs.length })
  return errorDiagnosticsOf(
    Arr.flatten(yield* Effect.forEach(programs, (program) => wholeProgramDiagnosticsOf(program))),
  )
})

const errorDiagnosticsOf = (diagnostics: readonly Diagnostic[]): readonly Diagnostic[] =>
  Arr.filter(diagnostics, (diagnostic) => diagnostic.category === DiagnosticCategory.Error)

const affectedFileNamesOf = (
  state: CompilerState,
  mutatedFileNames: ReadonlyArray<string>,
): HashSet.HashSet<string> => {
  const command = TraceAffectedFilesCommand.make({
    importsByFile: Object.fromEntries(
      Arr.map(Arr.fromIterable(state.sourceFiles), ([fileName, entry]) => [fileName, Arr.fromIterable(entry.imports)]),
    ),
    mutatedFileNames: [...mutatedFileNames],
  })
  const affected = decided(traceAffectedFiles(command))
  return HashSet.fromIterable(Arr.map(affected, (affectedFile) => affectedFile.fileName))
}

export const check: {
  (
    mutants: readonly Checker.CheckerMutantWire[],
  ): (self: TSCompiler) => Effect.Effect<readonly Diagnostic[], CompilerError>
  (self: TSCompiler, mutants: readonly Checker.CheckerMutantWire[]): Effect.Effect<readonly Diagnostic[], CompilerError>
} = dual(
  2,
  Effect.fn('typescript-checker.compiler.check')(function*(
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
  ): Effect.fn.Return<readonly Diagnostic[], CompilerError> {
    const rt = runtimeOf(self)
    yield* Effect.annotateCurrentSpan({
      'stryker.mutants.count': mutants.length,
      'stryker.mutants.ids': Arr.map(mutants, (mutant) => mutant.id).join(','),
    })
    const state = yield* SynchronizedRef.get(rt.state)
    yield* resetMutatedFiles(rt, state.lastMutants)
    yield* applyMutants(rt, mutants)
    const mutatedFileNames = Arr.dedupe(Arr.map(mutants, (mutant) => resolveFileName(rt, mutant.fileName)))
    const changedFiles = Arr.dedupe([...state.lastMutatedFileNames, ...mutatedFileNames])
    yield* refreshSnapshot(rt, changedFiles)
    yield* SynchronizedRef.update(rt.state, (prev) => ({
      ...prev,
      lastMutants: [...mutants],
      lastMutatedFileNames: mutatedFileNames,
    }))
    const affected = affectedFileNamesOf(state, mutatedFileNames)
    const programs = yield* programsOf(rt)
    const diagnostics = errorDiagnosticsOf(
      Arr.flatten(yield* Effect.forEach(programs, (program) => affectedDiagnosticsOf(program, affected))),
    )
    yield* Effect.annotateCurrentSpan({
      'typescript.diagnostics.count': diagnostics.length,
      'typescript.files.count': HashSet.size(affected),
    })
    yield* annotateDiagnosticSample(diagnostics)
    return diagnostics
  }),
)

export const nodes = Effect.fn('typescript-checker.compiler.nodes')(function*(self: TSCompiler) {
  return yield* self.pipe(runtimeOf, nodesOf)
})

const groupedMutants = Effect.fn('typescript-checker.compiler.groups')(function*(
  self: TSCompiler,
  mutants: readonly Checker.CheckerMutantWire[],
  prioritizePerformanceOverAccuracy: boolean,
): Effect.fn.Return<ReadonlyArray<ReadonlyArray<string>>, CompilerError> {
  const graphNodes = yield* self.pipe(runtimeOf, nodesOf)
  const command = GroupMutantsCommand.make({
    mutants: [...mutants],
    nodes: Object.fromEntries(graphNodes),
    prioritizePerformanceOverAccuracy,
  })
  const decidedGroups = decided(groupMutants(command))
  return Arr.map(decidedGroups, (group) => group.ids)
})

export const groups: {
  (
    mutants: readonly Checker.CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): (self: TSCompiler) => Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError>
  (
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError>
} = dual(
  3,
  (
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
    prioritizePerformanceOverAccuracy: boolean,
  ): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError> =>
    groupedMutants(self, mutants, prioritizePerformanceOverAccuracy),
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
  Effect.fn('typescript-checker.compiler.lineAndCharacter')(function*(
    self: TSCompiler,
    fileName: string,
    position: number,
  ) {
    const rt = runtimeOf(self)
    const programs = yield* programsOf(rt).pipe(Effect.orElseSucceed((): ReadonlyArray<Program> => []))
    const found = yield* sourceFileOf(programs, fileName)
    return Option.getOrUndefined(
      Option.map(found, (sourceFile) => sourceFile.getLineAndCharacterOfPosition(position)),
    )
  }),
)

const CLOSE_GRACE = '1 second'

export const close = Effect.fn('typescript-checker.compiler.close')(function*(self: TSCompiler) {
  const rt = runtimeOf(self)
  const state = yield* SynchronizedRef.getAndUpdate(rt.state, (prev) => ({
    ...prev,
    snapshot: undefined,
    api: undefined,
  }))
  const released = yield* Option.match(Option.fromUndefinedOr(state.api), {
    onNone: () => Effect.succeed(true),
    onSome: (api) =>
      Effect.tryPromise(() => api.close()).pipe(
        Effect.timeoutOption(CLOSE_GRACE),
        Effect.tapError((error) => Effect.annotateCurrentSpan('typescript.server.close_error', error.message)),
        Effect.match({ onFailure: () => false, onSuccess: Option.isSome }),
      ),
  })
  yield* Effect.annotateCurrentSpan('typescript.server.released', released)
})
