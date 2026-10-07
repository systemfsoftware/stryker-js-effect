import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Handle } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { offsetAt } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SynchronizedRef from 'effect/SynchronizedRef'
import type { Node, SourceFile } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import { isModuleDeclaration } from 'typescript/unstable/ast/is'
import {
  API,
  type Diagnostic,
  DiagnosticCategory,
  ModifierFlags,
  type Program,
  type Project,
  type Snapshot,
} from 'typescript/unstable/async'
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
import {
  type DiagnosticDecoded,
  DiagnosticLine,
  type DiagnosticSeverity,
  type NodeDecodedShape,
} from './CheckMutants.schema.js'
import {
  classifyTce,
  ClassifyTceCommand,
  type TceCandidate,
  type TceClassification,
  type TceDecision,
} from './classify-tce.workflow.js'
import { type CompilerError, CompilerFailed, UnsupportedTypeScriptVersionError } from './Compiler.schema.js'
import { groupMutants } from './group-mutants.workflow.js'
import { identifyProgram as identifyProgramWorkflow, IdentifyProgramCommand } from './identify-program.workflow.js'
import { overrideTsconfigOptions } from './override-tsconfig-options.workflow.js'
import { parseTsconfigText } from './parse-tsconfig-text.workflow.js'
import { planDiagnosticBatches } from './plan-diagnostic-batches.workflow.js'
import { planResolutionCandidates } from './plan-resolution-candidates.workflow.js'
import { type ProgramFile } from './program-digest.schema.js'
import { requestAffectedFiles } from './request-affected-files.workflow.js'
import { emitNormalized } from './tce-emit.js'
import { traceAffectedFiles } from './trace-affected-files.workflow.js'
import {
  getFile,
  make as makeTSFiles,
  mutateFile,
  resetFile,
  type ScriptFile,
  setOverrides,
  type TSFiles,
  tsFileSystem,
} from './ts-files.handle.js'
import {
  PathAliasesSchema,
  type TsConfigCompilerOptions,
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
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner['Service']
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
    services: {
      readonly host: FileSystem.FileSystem
      readonly pathService: Path.Path
      readonly spawner: ChildProcessSpawner.ChildProcessSpawner['Service']
    },
  ): Effect.Effect<TSCompiler>
  (
    services: {
      readonly host: FileSystem.FileSystem
      readonly pathService: Path.Path
      readonly spawner: ChildProcessSpawner.ChildProcessSpawner['Service']
    },
  ): (options: Options.StrykerOptions) => Effect.Effect<TSCompiler>
} = dual(
  2,
  Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerMake.name)(function*(
    options: Options.StrykerOptions,
    services: {
      readonly host: FileSystem.FileSystem
      readonly pathService: Path.Path
      readonly spawner: ChildProcessSpawner.ChildProcessSpawner['Service']
    },
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
      spawner: services.spawner,
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

const readCheckerVersion = Effect.fnUntraced(function*(rt: TSCompilerRuntime) {
  const packagePath = yield* rt.pathService.fromFileUrl(new URL('../package.json', import.meta.url))
  const text = yield* rt.host.readFileString(packagePath).pipe(Effect.orElseSucceed(() => ''))
  return Result.match(S.decodeResult(S.fromJsonString(S.Struct({ version: S.String })))(text), {
    onFailure: () => '',
    onSuccess: (pkg) => pkg.version,
  })
})

type JsonValue = S.Schema.Type<typeof S.Json>

const isJsonObject = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const canonicalJsonOf = (value: JsonValue): string =>
  Array.isArray(value)
    ? `[${value.map(canonicalJsonOf).join(',')}]`
    : isJsonObject(value)
    ? `{${
      Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJsonOf(value[key] as JsonValue)}`)
        .join(',')
    }}`
    : JSON.stringify(value)

const checkerOptionsJsonOf = (options: Options.StrykerOptions): Effect.Effect<string, CompilerError> =>
  Option.match(Option.fromUndefinedOr(options['typescriptChecker']), {
    onNone: () => Effect.succeed('{}'),
    onSome: (configured) =>
      Result.match(S.decodeUnknownResult(S.Json)(configured), {
        onFailure: () =>
          Effect.fail(CompilerFailed.make({ reason: 'program-digest-unavailable', subject: 'checker options' })),
        onSuccess: (value) => Effect.succeed(canonicalJsonOf(value)),
      }),
  })

const readProgramFiles = (
  rt: TSCompilerRuntime,
  root: string,
  fileNames: readonly string[],
): Effect.Effect<readonly ProgramFile[], CompilerError> =>
  Effect.forEach(
    fileNames,
    (fileName): Effect.Effect<ProgramFile, CompilerError> =>
      Effect.map(
        Effect.mapError(
          rt.host.readFileString(fileName),
          () => CompilerFailed.make({ reason: 'program-digest-unavailable', subject: fileName }),
        ),
        (content): ProgramFile => ({
          fileName: normalizeFileName(rt.pathService.relative(root, fileName)),
          digest: sha256HexOf(content),
        }),
      ),
    { concurrency: 1 },
  )

const sortedSourceFileNamesOf = (programs: ReadonlyArray<Program>): Effect.Effect<readonly string[]> =>
  Effect.map(
    Effect.forEach(programs, (program) => Effect.promise(() => program.getSourceFileNames())),
    (perProgram) => Arr.sort(Arr.dedupe(Arr.map(Arr.flatten(perProgram), normalizeFileName)), Order.String),
  )

const sha256HexOf = (content: string): string => bytesToHex(sha256(utf8ToBytes(content)))

const decidedProgramIdentity = (
  command: IdentifyProgramCommand,
): Effect.Effect<Checker.ProgramDigest, CompilerError> => {
  const identity = decided(identifyProgramWorkflow(command))
  return Match.value(identity).pipe(
    Match.tag('ProgramIdentified', ({ key }) => Effect.succeed(Checker.ProgramDigest.make(sha256HexOf(key)))),
    Match.tag(
      'ProgramUnidentified',
      ({ reason }) => Effect.fail(CompilerFailed.make({ reason: 'program-digest-unavailable', subject: reason })),
    ),
    Match.exhaustive,
  )
}

export const programDigest = Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerProgramDigest.name)(function*(
  self: TSCompiler,
): Effect.fn.Return<Checker.ProgramDigest, CompilerError> {
  const rt = runtimeOf(self)
  const programs = yield* programsOf(rt)
  const state = yield* SynchronizedRef.get(rt.state)
  const typescriptVersion = yield* readTypescriptVersion(rt).pipe(Effect.orElseSucceed(() => ''))
  const checkerVersion = yield* readCheckerVersion(rt).pipe(Effect.orElseSucceed(() => ''))
  yield* Boolean.match(Boolean.or(typescriptVersion === '', checkerVersion === ''), {
    onTrue: () =>
      Effect.fail(CompilerFailed.make({ reason: 'program-digest-unavailable', subject: 'toolchain version' })),
    onFalse: () => Effect.void,
  })
  const checkerOptionsJson = yield* checkerOptionsJsonOf(rt.options)
  const root = rt.pathService.dirname(state.tsconfigFile)
  const sourceFiles = yield* readProgramFiles(rt, root, yield* sortedSourceFileNamesOf(programs))
  const tsconfigs = yield* readProgramFiles(
    rt,
    root,
    yield* tsConfigChainOf(rt, Arr.sort(Arr.fromIterable(state.allTSConfigFiles), Order.String)),
  )
  return yield* decidedProgramIdentity(
    IdentifyProgramCommand.make({ typescriptVersion, checkerVersion, checkerOptionsJson, sourceFiles, tsconfigs }),
  )
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
  Option.getOrElse(Option.fromUndefinedOr(config.references), (): ReadonlyArray<{ readonly path: string }> => [])

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

const TS_CONFIG_JSON_EXTENSION = '.json'

const NODE_MODULES_DIRECTORY = 'node_modules'

const tsConfigExtendsOf = (config: TsConfigDocument): ReadonlyArray<string> => {
  const declared = config['extends']
  return declared === undefined ? [] : typeof declared === 'string' ? [declared] : [...declared]
}

const ancestorDirectoriesOf = (pathService: Path.Path, from: string): ReadonlyArray<string> => {
  const directories: Array<string> = [from]
  let current = from
  let parent = pathService.dirname(current)
  while (parent !== current) {
    directories.push(parent)
    current = parent
    parent = pathService.dirname(current)
  }
  return directories
}

const isRelativeSpecifier = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../')

const withJsonExtension = (base: string): ReadonlyArray<string> =>
  base.endsWith(TS_CONFIG_JSON_EXTENSION) ? [base] : [base, `${base}${TS_CONFIG_JSON_EXTENSION}`]

const tsConfigExtendsCandidatesOf = (
  pathService: Path.Path,
  fromDirName: string,
  specifier: string,
): ReadonlyArray<string> =>
  Boolean.match(pathService.isAbsolute(specifier) || isRelativeSpecifier(specifier), {
    onTrue: () => withJsonExtension(normalizeFileName(pathService.resolve(fromDirName, specifier))),
    onFalse: () =>
      Arr.flatMap(ancestorDirectoriesOf(pathService, fromDirName), (directory) =>
        Arr.flatMap(withJsonExtension(specifier), (candidate) => [
          normalizeFileName(pathService.join(directory, NODE_MODULES_DIRECTORY, candidate)),
          ...Boolean.match(candidate.endsWith(TS_CONFIG_JSON_EXTENSION), {
            onTrue: (): ReadonlyArray<string> => [],
            onFalse: () => [
              normalizeFileName(pathService.join(directory, NODE_MODULES_DIRECTORY, candidate, 'tsconfig.json')),
            ],
          }),
        ])),
  })

const isFileOf = (rt: TSCompilerRuntime, fileName: string): Effect.Effect<boolean> =>
  rt.host.stat(fileName).pipe(
    Effect.map((info) => info.type === 'File'),
    Effect.orElseSucceed(() => false),
  )

const resolveTsConfigExtends = (
  rt: TSCompilerRuntime,
  fromDirName: string,
  specifier: string,
): Effect.Effect<string, CompilerError> =>
  Effect.gen(function*() {
    const candidates = tsConfigExtendsCandidatesOf(rt.pathService, fromDirName, specifier)
    for (const candidate of candidates) {
      if (yield* isFileOf(rt, candidate)) {
        return candidate
      }
    }
    return yield* Effect.fail(
      CompilerFailed.make({ reason: 'program-digest-unavailable', subject: `tsconfig extends "${specifier}"` }),
    )
  })

const tsConfigChainOf = (
  rt: TSCompilerRuntime,
  seeds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, CompilerError> =>
  Effect.gen(function*() {
    const visited = new Set<string>()
    const chain: Array<string> = []
    const pending: Array<string> = [...seeds]
    while (pending.length > 0) {
      const fileName = pending.pop() as string
      if (visited.has(fileName)) {
        continue
      }
      visited.add(fileName)
      chain.push(fileName)
      const jsonText = yield* readTsConfigText(rt, HashMap.empty(), fileName)
      const parsed = parseTsConfig(fileName, jsonText)
      if (Result.isFailure(parsed)) {
        return yield* Effect.fail(parsed.failure)
      }
      const extended = yield* Effect.forEach(
        tsConfigExtendsOf(parsed.success),
        (specifier) => resolveTsConfigExtends(rt, rt.pathService.dirname(fileName), specifier),
      )
      pending.push(...extended)
    }
    return chain
  })

interface TsConfigWalk {
  readonly overrides: HashMap.HashMap<string, string>
  readonly files: HashSet.HashSet<string>
  readonly processed: HashSet.HashSet<string>
  readonly aliases: ReadonlyArray<PathAlias>
}

const compilerOptionsOf = (config: TsConfigDocument): TsConfigCompilerOptions =>
  Option.getOrElse(Option.fromUndefinedOr(config.compilerOptions), (): TsConfigCompilerOptions => ({}))

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

const projectsOf = (rt: TSCompilerRuntime): Effect.Effect<ReadonlyArray<Project>, CompilerFailed> =>
  Effect.flatMap(SynchronizedRef.get(rt.state), (state) =>
    Effect.flatMap(snapshotOf(state), (snapshot) => {
      const projects = snapshot.getProjects()
      return Boolean.match(projects.length === 0, {
        onTrue: () => Effect.fail(CompilerFailed.make({ reason: 'no-projects', subject: state.tsconfigFile })),
        onFalse: () => Effect.succeed(projects),
      })
    }))

const programsOf = (rt: TSCompilerRuntime): Effect.Effect<ReadonlyArray<Program>, CompilerFailed> =>
  Effect.map(projectsOf(rt), (projects) => Arr.map(projects, (project) => project.program))

const resolveFileName = (rt: TSCompilerRuntime, fileName: string) => normalizeFileName(rt.pathService.resolve(fileName))

const nodeSpanOf = (node: Node): { readonly start: number; readonly end: number } => ({
  start: node.getStart(node.getSourceFile()),
  end: node.end,
})

const childrenOf = (node: Node): ReadonlyArray<Node> => {
  const children: Array<Node> = []
  node.forEachChild((child) => {
    children.push(child)
  })
  return children
}

const spanEqualsOf = (node: Node, start: number, end: number): boolean => {
  const span = nodeSpanOf(node)
  return span.start === start && span.end === end
}

const spanContainsOf = (node: Node, start: number, end: number): boolean => {
  const span = nodeSpanOf(node)
  return span.start <= start && end <= span.end
}

const hasSpanOf = (node: Node, start: number, end: number): boolean => {
  if (spanEqualsOf(node, start, end)) return true
  return Arr.some(
    childrenOf(node),
    (child) => Boolean.and(spanContainsOf(child, start, end), hasSpanOf(child, start, end)),
  )
}

const parseHeldOf = (sourceFile: SourceFile, file: ScriptFile, mutant: Checker.CheckerMutantWire): boolean =>
  Option.match(offsetAt(file.lineStarts, mutant.location.start), {
    onNone: () => true,
    onSome: (start) => hasSpanOf(sourceFile, start, start + mutant.replacement.length),
  })

const mutatedSourceFileOf = (
  rt: TSCompilerRuntime,
  fileName: string,
): Effect.Effect<Option.Option<SourceFile>, CompilerFailed> =>
  Effect.flatMap(
    projectsOf(rt),
    (projects) =>
      Effect.map(projectOfFile(projects, fileName), (owned) => Option.map(owned, (found) => found.sourceFile)),
  )

const parseHeldAfterSpliceOf = (
  rt: TSCompilerRuntime,
  file: Option.Option<ScriptFile>,
  mutant: Checker.CheckerMutantWire,
  fileName: string,
): Effect.Effect<boolean, CompilerFailed> =>
  Effect.gen(function*() {
    const sourceFile = yield* mutatedSourceFileOf(rt, fileName)
    return Option.match(Option.all([file, sourceFile]), {
      onNone: () => true,
      onSome: ([spliced, mutated]) => parseHeldOf(mutated, spliced, mutant),
    })
  })

const parenthesizedSpliceOf = (
  rt: TSCompilerRuntime,
  mutant: Checker.CheckerMutantWire,
  fileName: string,
  changedFiles: ReadonlyArray<string>,
): Effect.Effect<void, CompilerFailed> =>
  Effect.flatMap(applyMutant(rt, mutant, '(' + mutant.replacement + ')'), () => refreshSnapshot(rt, changedFiles))

const applyMutant = (
  rt: TSCompilerRuntime,
  mutant: Checker.CheckerMutantWire,
  replacement: string,
): Effect.Effect<void, CompilerFailed> =>
  Effect.flatMap(getFile(rt.files, resolveFileName(rt, mutant.fileName)), (file) =>
    Effect.flatMap(
      Effect.fromOption(file, () => CompilerFailed.make({ reason: 'file-not-in-project', subject: mutant.fileName })),
      () =>
        Effect.mapError(
          mutateFile(rt.files, resolveFileName(rt, mutant.fileName), { location: mutant.location, replacement }),
          (error) =>
            Match.value(error).pipe(
              Match.tag('HybridFileNotFoundError', () =>
                CompilerFailed.make({ reason: 'file-not-in-project', subject: mutant.fileName })),
              Match.tag('HybridMutantOutsideFileError', () =>
                CompilerFailed.make({ reason: 'mutant-outside-file', subject: mutant.fileName })),
              Match.exhaustive,
            ),
        ),
    ))

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

const fileNode = (
  fileName: string,
  children: ReadonlyArray<FileNode>,
  parents: ReadonlyArray<FileNode> = [],
): FileNode => ({
  children,
  fileName,
  parents,
})

const importersOf = (sourceFiles: SourceFiles): HashMap.HashMap<string, ReadonlyArray<string>> =>
  Arr.reduce(
    Arr.fromIterable(sourceFiles),
    HashMap.empty<string, ReadonlyArray<string>>(),
    (accumulated, [importer, file]) =>
      Arr.reduce(
        Arr.fromIterable(file.imports),
        accumulated,
        (into, imported) =>
          HashMap.set(into, imported, [
            ...Option.getOrElse(HashMap.get(into, imported), (): ReadonlyArray<string> => []),
            importer,
          ]),
      ),
  )

const graphNodesOf = (sourceFiles: SourceFiles): GraphNodes => {
  const entries = Arr.fromIterable(sourceFiles)
  const importers = importersOf(sourceFiles)
  const leaves = HashMap.fromIterable(
    Arr.map(entries, ([fileName]): readonly [string, FileNode] => [fileName, fileNode(fileName, [])]),
  )
  return HashMap.fromIterable(
    Arr.map(entries, ([fileName, file]): readonly [string, FileNode] => [
      fileName,
      fileNode(
        fileName,
        Arr.filterMap(Arr.fromIterable(file.imports), (imported) => keepSome(HashMap.get(leaves, imported))),
        Arr.filterMap(
          Option.getOrElse(HashMap.get(importers, fileName), (): ReadonlyArray<string> => []),
          (importer) => keepSome(HashMap.get(leaves, importer)),
        ),
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

export const init = Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerInit.name)(function*(
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

const wholeProgramDiagnosticsOf = (program: Program): Effect.Effect<readonly Diagnostic[]> =>
  Effect.all(
    [programWideDiagnosticsOf(program), Effect.promise(() => program.getSemanticDiagnostics())],
    { concurrency: 2 },
  ).pipe(Effect.map(([programWide, semantic]) => [...semantic, ...programWide]))

const dryRunDiagnostics = Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerDryRun.name)(function*(
  programs: ReadonlyArray<Program>,
) {
  yield* Effect.annotateCurrentSpan({ 'typescript.projects.count': programs.length })
  return errorDiagnosticsOf(
    Arr.flatten(yield* Effect.forEach(programs, (program) => wholeProgramDiagnosticsOf(program))),
  )
})

const errorDiagnosticsOf = (diagnostics: readonly Diagnostic[]): readonly Diagnostic[] =>
  Arr.filter(diagnostics, (diagnostic) => diagnostic.category === DiagnosticCategory.Error)

interface OwnedSourceFile {
  readonly project: Project
  readonly sourceFile: SourceFile
}

export interface MutantCheck {
  readonly mutantId: Checker.CheckerMutantWire['id']
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly tce?: TceClassification
}

const projectOfFile = (
  projects: ReadonlyArray<Project>,
  fileName: string,
): Effect.Effect<Option.Option<OwnedSourceFile>> =>
  Option.match(Arr.head(projects), {
    onNone: () => Effect.succeedNone,
    onSome: (project) =>
      Effect.flatMap(
        Effect.promise(() => project.program.getSourceFile(fileName)),
        (sourceFile) =>
          Option.match(Option.fromUndefinedOr(sourceFile), {
            onNone: () => projectOfFile(Arr.drop(projects, 1), fileName),
            onSome: (found) => Effect.succeedSome({ project, sourceFile: found }),
          }),
      ),
  })

const isAmbientGlobal = (sourceFile: SourceFile, statement: Node): boolean =>
  isModuleDeclaration(statement)
    ? Boolean.and(
      (statement.modifierFlags & ModifierFlags.Ambient) !== 0,
      statement.name.getText(sourceFile) === 'global',
    )
    : false

const declaresGlobalScope = (sourceFile: SourceFile): boolean =>
  Boolean.or(
    sourceFile.externalModuleIndicator === undefined,
    Arr.some(sourceFile.statements, (statement) => isAmbientGlobal(sourceFile, statement)),
  )

const importerErrorsOf = (
  projects: ReadonlyArray<Project>,
  fileNames: HashSet.HashSet<string>,
): Effect.Effect<ReadonlyArray<Diagnostic>> =>
  Effect.map(
    Effect.forEach(projects, (project) => semanticDiagnosticsOf(project.program, fileNames), { concurrency: 1 }),
    (perProject) => errorDiagnosticsOf(Arr.flatten(perProject)),
  )

const wholeProgramErrorsOf = (projects: ReadonlyArray<Project>): Effect.Effect<ReadonlyArray<Diagnostic>> =>
  Effect.map(
    Effect.forEach(projects, (project) => wholeProgramDiagnosticsOf(project.program), { concurrency: 1 }),
    (perProject) => errorDiagnosticsOf(Arr.flatten(perProject)),
  )

const ownErrorsOf = (owned: OwnedSourceFile, fileName: string): Effect.Effect<ReadonlyArray<Diagnostic>> =>
  Effect.map(Effect.promise(() => owned.project.program.getSemanticDiagnostics(fileName)), errorDiagnosticsOf)

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

const importerErrorsOfMutant = (
  state: CompilerState,
  projects: ReadonlyArray<Project>,
  mutant: Checker.CheckerMutantWire,
  fileName: string,
): Effect.Effect<MutantCheck> =>
  Effect.map(
    importerErrorsOf(projects, affectedFileNamesOf(state, [fileName])),
    (diagnostics): MutantCheck => ({ mutantId: mutant.id, diagnostics }),
  )

const beyondOwnErrorsOf = (
  state: CompilerState,
  projects: ReadonlyArray<Project>,
  mutant: Checker.CheckerMutantWire,
  owned: OwnedSourceFile,
  fileName: string,
): Effect.Effect<MutantCheck> =>
  Boolean.match(declaresGlobalScope(owned.sourceFile), {
    onTrue: () =>
      Effect.map(wholeProgramErrorsOf(projects), (diagnostics): MutantCheck => ({ mutantId: mutant.id, diagnostics })),
    onFalse: () => importerErrorsOfMutant(state, projects, mutant, fileName),
  })

const checkedIn = (
  state: CompilerState,
  projects: ReadonlyArray<Project>,
  mutant: Checker.CheckerMutantWire,
  owned: OwnedSourceFile,
  fileName: string,
): Effect.Effect<MutantCheck> =>
  Effect.flatMap(ownErrorsOf(owned, fileName), (own) =>
    Boolean.match(own.length > 0, {
      onTrue: () => Effect.succeed<MutantCheck>({ mutantId: mutant.id, diagnostics: own }),
      onFalse: () => beyondOwnErrorsOf(state, projects, mutant, owned, fileName),
    }))

const checkOne = (
  rt: TSCompilerRuntime,
  state: CompilerState,
  mutant: Checker.CheckerMutantWire,
  previousMutants: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<MutantCheck, CompilerFailed> =>
  Effect.gen(function*() {
    yield* resetMutatedFiles(rt, previousMutants)
    const fileName = resolveFileName(rt, mutant.fileName)
    const previousFileNames = Arr.map(previousMutants, (previous) => resolveFileName(rt, previous.fileName))
    const changedFiles = Arr.dedupe([...previousFileNames, fileName])
    const file = yield* getFile(rt.files, fileName)
    yield* applyMutant(rt, mutant, mutant.replacement)
    yield* refreshSnapshot(rt, changedFiles)
    const held = yield* parseHeldAfterSpliceOf(rt, file, mutant, fileName)
    yield* Boolean.match(held, {
      onTrue: () => Effect.void,
      onFalse: () => parenthesizedSpliceOf(rt, mutant, fileName, changedFiles),
    })
    const projects = yield* projectsOf(rt)
    const owned = yield* projectOfFile(projects, fileName)
    return yield* Option.match(owned, {
      onNone: () => Effect.succeed<MutantCheck>({ mutantId: mutant.id, diagnostics: [] }),
      onSome: (found) => checkedIn(state, projects, mutant, found, fileName),
    })
  })

interface CheckAccumulator {
  readonly previous: Option.Option<Checker.CheckerMutantWire>
  readonly results: ReadonlyArray<MutantCheck>
}

const siteKeyOf = (mutant: Checker.CheckerMutantWire): string =>
  `${mutant.fileName}:${mutant.location.start.line}:${mutant.location.start.column}:${mutant.location.end.line}:${mutant.location.end.column}`

const splicedContentOf = (file: ScriptFile, mutant: Checker.CheckerMutantWire): Option.Option<string> =>
  Option.map(
    Option.all([
      offsetAt(file.lineStarts, mutant.location.start),
      offsetAt(file.lineStarts, mutant.location.end),
    ]),
    ([start, end]) => file.originalContent.slice(0, start) + mutant.replacement + file.originalContent.slice(end),
  )

interface TceEntry {
  readonly key: string
  readonly content: string
  readonly site: string
}

const tceEntriesOf = (
  script: ScriptFile,
  fileMutants: readonly Checker.CheckerMutantWire[],
): ReadonlyArray<TceEntry> =>
  Arr.getSomes(
    Arr.map(
      fileMutants,
      (mutant): Option.Option<TceEntry> =>
        Option.map(splicedContentOf(script, mutant), (content) => ({
          key: mutant.id,
          content,
          site: siteKeyOf(mutant),
        })),
    ),
  )

const tceCandidatesOf = (
  entries: ReadonlyArray<TceEntry>,
  byKey: HashMap.HashMap<string, string>,
): ReadonlyArray<TceCandidate> =>
  Arr.getSomes(
    Arr.map(entries, (entry): Option.Option<TceCandidate> =>
      Option.map(HashMap.get(byKey, entry.key), (emit) => ({
        id: entry.key,
        site: entry.site,
        emit,
      }))),
  )

const emitForFile = (
  rt: TSCompilerRuntime,
  tsconfigFile: string,
  fileName: string,
  script: ScriptFile,
  entries: ReadonlyArray<TceEntry>,
) =>
  emitNormalized({
    tsconfigFile,
    sourceExtension: rt.pathService.extname(fileName),
    originalContent: script.originalContent,
    mutants: Arr.map(entries, (entry) => ({ key: entry.key, content: entry.content })),
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, rt.host),
    Effect.provideService(Path.Path, rt.pathService),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, rt.spawner),
  )

const tceScriptOf = <A>(file: Option.Option<A>, fileName: string): Result.Result<A, CompilerFailed> =>
  Option.match(file, {
    onNone: () => Result.fail(CompilerFailed.make({ reason: 'file-not-in-project', subject: fileName })),
    onSome: (script) => Result.succeed(script),
  })

const decisionsOfFile = Effect.fnUntraced(function*(
  rt: TSCompilerRuntime,
  tsconfigFile: string,
  fileName: string,
  fileMutants: readonly Checker.CheckerMutantWire[],
): Effect.fn.Return<ReadonlyArray<TceDecision>, CompilerFailed> {
  const file = yield* getFile(rt.files, fileName)
  const script = yield* Effect.fromResult(tceScriptOf(file, fileName))
  const entries = tceEntriesOf(script, fileMutants)
  const emitted = yield* Option.match(Option.liftPredicate(entries, (present) => present.length > 0), {
    onNone: () => Effect.succeedNone,
    onSome: (present) => emitForFile(rt, tsconfigFile, fileName, script, present),
  })
  return Option.match(emitted, {
    onNone: (): ReadonlyArray<TceDecision> => [],
    onSome: (result) =>
      decided(
        classifyTce(
          ClassifyTceCommand.make({
            originalEmit: result.original,
            candidates: tceCandidatesOf(entries, result.byKey),
          }),
        ),
      ),
  })
})

const classifyBatchTce = Effect.fnUntraced(function*(
  rt: TSCompilerRuntime,
  tsconfigFile: string,
  mutants: readonly Checker.CheckerMutantWire[],
  checked: ReadonlyArray<MutantCheck>,
): Effect.fn.Return<ReadonlyArray<MutantCheck>, CompilerFailed> {
  const passedIds = HashSet.fromIterable(
    Arr.map(Arr.filter(checked, (entry) => entry.diagnostics.length === 0), (entry) => entry.mutantId),
  )
  const passedMutants = Arr.filter(mutants, (mutant) => HashSet.has(passedIds, mutant.id))
  const fileNames = Arr.dedupe(Arr.map(passedMutants, (mutant) => resolveFileName(rt, mutant.fileName)))
  const perFile = yield* Effect.forEach(
    fileNames,
    (fileName) =>
      decisionsOfFile(
        rt,
        tsconfigFile,
        fileName,
        Arr.filter(passedMutants, (mutant) => resolveFileName(rt, mutant.fileName) === fileName),
      ),
  )
  const decisions = Arr.flatten(perFile)
  return Arr.map(
    checked,
    (entry) =>
      Option.match(Arr.findFirst(decisions, (decision) => decision.id === entry.mutantId), {
        onNone: () => entry,
        onSome: (decision) => ({ ...entry, tce: decision.classification }),
      }),
  )
})

export const check: {
  (
    mutants: readonly Checker.CheckerMutantWire[],
  ): (self: TSCompiler) => Effect.Effect<ReadonlyArray<MutantCheck>, CompilerError>
  (
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
  ): Effect.Effect<ReadonlyArray<MutantCheck>, CompilerError>
} = dual(
  2,
  Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerCheck.name)(function*(
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
  ): Effect.fn.Return<ReadonlyArray<MutantCheck>, CompilerError> {
    const rt = runtimeOf(self)
    yield* Effect.annotateCurrentSpan({
      'stryker.mutants.count': mutants.length,
      'stryker.mutants.ids': Arr.map(mutants, (mutant) => mutant.id).join(','),
    })
    const state = yield* SynchronizedRef.get(rt.state)
    yield* resetMutatedFiles(rt, state.lastMutants)
    const batchFileNames = Arr.dedupe(Arr.map(mutants, (mutant) => resolveFileName(rt, mutant.fileName)))
    yield* refreshSnapshot(rt, Arr.dedupe([...state.lastMutatedFileNames, ...batchFileNames]))
    const accumulated = yield* Effect.reduce(
      mutants,
      (): CheckAccumulator => ({ previous: Option.none(), results: [] }),
      (previous, mutant) =>
        Effect.map(
          checkOne(rt, state, mutant, Option.toArray(previous.previous)),
          (result): CheckAccumulator => ({ previous: Option.some(mutant), results: [...previous.results, result] }),
        ),
    )
    const checked = yield* classifyBatchTce(rt, state.tsconfigFile, mutants, accumulated.results)
    yield* SynchronizedRef.update(rt.state, (prev) => ({
      ...prev,
      lastMutants: [...mutants],
      lastMutatedFileNames: batchFileNames,
    }))
    const failed = Arr.filter(checked, (entry) => entry.diagnostics.length > 0)
    const equivalentToOriginal = Arr.filter(checked, (entry) => entry.tce === 'original').length
    const duplicateAtSite = Arr.filter(checked, (entry) => entry.tce === 'sibling').length
    yield* Effect.annotateCurrentSpan({
      'typescript.diagnostics.count': Arr.reduce(checked, 0, (total, entry) => total + entry.diagnostics.length),
      'typescript.compile_errors.count': failed.length,
      'typescript.tce.equivalent_to_original.count': equivalentToOriginal,
      'typescript.tce.duplicate_at_site.count': duplicateAtSite,
    })
    yield* annotateDiagnosticSample(Arr.flatten(Arr.map(failed, (entry) => entry.diagnostics)))
    return checked
  }),
)

export const nodes = Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerNodes.name)(function*(self: TSCompiler) {
  return yield* self.pipe(runtimeOf, nodesOf)
})

const groupedMutants = (mutants: readonly Checker.CheckerMutantWire[]): ReadonlyArray<ReadonlyArray<string>> =>
  Arr.map(
    decided(groupMutants(GroupMutantsCommand.make({ mutants: [...mutants] }))),
    (group) => group.ids,
  )

export const groups = (
  mutants: readonly Checker.CheckerMutantWire[],
): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>> =>
  Effect.sync(() => groupedMutants(mutants)).pipe(
    Effect.withSpan(SpanTaxonomy.Spans.typescriptCheckerCompilerGroups.name),
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
  Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerLineAndCharacter.name)(function*(
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

const severityOf = (category: Diagnostic['category']): DiagnosticSeverity =>
  Match.value(category).pipe(
    Match.when(DiagnosticCategory.Warning, (): DiagnosticSeverity => 'warning'),
    Match.when(DiagnosticCategory.Error, (): DiagnosticSeverity => 'error'),
    Match.when(DiagnosticCategory.Suggestion, (): DiagnosticSeverity => 'suggestion'),
    Match.orElse((): DiagnosticSeverity => 'message'),
  )

const renderPosition = (fileName: string, at: { line: number; character: number } | undefined): string =>
  Option.match(Option.fromUndefinedOr(at), {
    onNone: () => fileName + '(1,1): ',
    onSome: (position) => fileName + '(' + (position.line + 1) + ',' + (position.character + 1) + '): ',
  })

const positionOf = (self: TSCompiler, diagnostic: Diagnostic): Effect.Effect<string> =>
  Option.match(Option.filter(Option.fromUndefinedOr(diagnostic.fileName), (fileName) => fileName !== ''), {
    onNone: () => Effect.succeed(''),
    onSome: (fileName) =>
      getLineAndCharacterOfPosition(self, fileName, diagnostic.pos).pipe(
        Effect.orElseSucceed(() => undefined),
        Effect.map((at) => renderPosition(fileName, at)),
      ),
  })

const describedOf = (self: TSCompiler, diagnostic: Diagnostic): Effect.Effect<DiagnosticDecoded> =>
  Effect.map(positionOf(self, diagnostic), (position) =>
    DiagnosticLine.make({
      position,
      severity: severityOf(diagnostic.category),
      code: diagnostic.code,
      text: diagnostic.text,
      ...(diagnostic.fileName === undefined ? {} : { fileName: diagnostic.fileName }),
    }))

export const describeDiagnostics: {
  (
    diagnostics: readonly Diagnostic[],
  ): (self: TSCompiler) => Effect.Effect<readonly DiagnosticDecoded[]>
  (
    self: TSCompiler,
    diagnostics: readonly Diagnostic[],
  ): Effect.Effect<readonly DiagnosticDecoded[]>
} = dual(
  2,
  (self: TSCompiler, diagnostics: readonly Diagnostic[]): Effect.Effect<readonly DiagnosticDecoded[]> =>
    Effect.forEach(diagnostics, (diagnostic) => describedOf(self, diagnostic)),
)

const CLOSE_GRACE = '1 second'

export const close = Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerClose.name)(function*(self: TSCompiler) {
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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const failsNamingTheFile = (refused: CompilerFailed, fileName: string): boolean =>
    refused.reason === 'file-not-in-project' && refused.subject === fileName

  it.prop(
    '∀fs_TceScriptOf_≡ScriptKeptOrRefusalNamingTheFile',
    {
      of: [S.Literals(['present', 'absent']), S.String, S.String],
      subject: (presence: 'present' | 'absent', content: string, fileName: string) =>
        tceScriptOf(presence === 'present' ? Option.some(content) : Option.none(), fileName),
    },
    (subject, [presence, content, fileName]) =>
      Result.match(subject(presence, content, fileName), {
        onFailure: (refused) => presence === 'absent' && failsNamingTheFile(refused, fileName),
        onSuccess: (kept) => presence === 'present' && kept === content,
      }),
  )
}
