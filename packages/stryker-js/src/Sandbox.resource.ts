import type { JsonValue } from '@std/jsonc'
import { parse } from '@std/jsonc'
import { ErrorText, Format, Instrument, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Boolean, Predicate, Schema as S } from 'effect'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import type { PlatformError } from 'effect/PlatformError'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import { FileMatcher } from './matching.schema.js'
import { ProjectFiles } from './project-files.service.js'
import type { Project, ProjectFile } from './Project.schema.js'
import { make as makeHandle, type SandboxHandle } from './Sandbox.handle.js'
import { ExtendsArraySchema, type TSConfig, TsConfigSchema } from './Sandbox.schema.js'
import { StrykerError } from './stryker-error.schema.js'

export interface MakeSandboxInput {
  readonly options: Options.StrykerOptions
  readonly project: Project
  readonly workingDirectory: string
  readonly backupDirectory: string
  readonly basePath: string
  readonly formatRegistry: Format.FormatRegistry
}

export type FilePreprocessor = (
  project: Project,
) => Effect.Effect<void, PlatformError | StrykerError, FileSystem.FileSystem | Path.Path | ProjectFiles>

const combinePreprocessors = (preprocessors: readonly FilePreprocessor[]) => (project: Project) =>
  Effect.forEach(preprocessors, (pre) => pre(project), { discard: true })

const mergeUpdatedFile = (project: Project, updated: ProjectFile): void => {
  MutableHashMap.set(project.files, updated.name, updated)
  Option.match(MutableHashMap.get(project.filesToMutate, updated.name), {
    onNone: () => undefined,
    onSome: () => MutableHashMap.set(project.filesToMutate, updated.name, updated),
  })
}

const updateOf = (updated: ProjectFile | Option.Option<ProjectFile> | undefined) =>
  Match.value(updated).pipe(
    Match.when(undefined, () => undefined),
    Match.when(Option.isOption, (option) => Option.getOrUndefined(option)),
    Match.orElse((file) => file),
  )

const mergeUpdatedInto = (project: Project) => (updated: ProjectFile | Option.Option<ProjectFile> | undefined) => {
  const file = updateOf(updated)
  Option.match(Option.fromUndefinedOr(file), {
    onNone: () => undefined,
    onSome: (present) => mergeUpdatedFile(project, present),
  })
}

const makeDisableTypeChecksPreprocessor =
  (options: Options.StrykerOptions, registry: Format.FormatRegistry, impl: typeof Instrument.disableTypeChecks) =>
  (project: Project) =>
    Effect.gen(function*() {
      const pathService = yield* Path.Path
      const files = yield* ProjectFiles
      const matcher = FileMatcher.make({ pattern: options.disableTypeChecks, allowHiddenFiles: true })
      const matched = [...project.files].filter(([name]) => matcher.matches(pathService, pathService.resolve(name)))
      const instrumented = yield* files.readAll(matched.map(([, file]) => file))
      const updates = yield* Effect.forEach(
        instrumented,
        ([file, content]) =>
          Effect.map(
            impl({ content, mutate: file.mutate, name: file.name }, registry).pipe(
              Effect.map((instrumentedFile) => instrumentedFile.content),
              Effect.mapError((cause) => StrykerError.make({ message: 'disableTypeChecks failed', cause })),
            ),
            (text) => ({ ...file, content: text }),
          ),
        { concurrency: 'unbounded' },
      )
      updates.forEach(mergeUpdatedInto(project))
    })

const parseJsonText = (jsonText: string): Effect.Effect<JsonValue, string> =>
  Effect.try({
    try: () => parse(jsonText.replace(/^\uFEFF/, '')),
    catch: (cause) =>
      Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
  })

const tsConfigShapeOf = (parsed: JsonValue): Option.Option<TSConfig> =>
  Option.filter(Option.some(parsed), S.is(TsConfigSchema))

const parseTsConfig = (fileName: string, jsonText: string): Effect.Effect<TSConfig, string> =>
  Effect.flatMap(parseJsonText(jsonText), (parsed) =>
    Effect.fromOption(
      tsConfigShapeOf(parsed),
      () => `parsed to ${JSON.stringify(parsed)}, which does not match the tsconfig shape this package consumes`,
    ))

const makeTSConfigPreprocessor = (options: Options.StrykerOptions, basePath: string): FilePreprocessor => {
  const rewriteReferenceOrKeep = (reference: string, tsconfigFileName: string, pathService: Path.Path) =>
    Match.value(tryRewriteReference(reference, tsconfigFileName, pathService, basePath)).pipe(
      Match.when(Predicate.isString, (rewritten) => rewritten),
      Match.orElse(() => reference),
    )

  const isStringArray = (value: unknown): value is readonly string[] =>
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')

  const rewriteFileArrayProperty = (
    config: TSConfig,
    tsconfigFileName: string,
    prop: 'exclude' | 'files' | 'include',
    pathService: Path.Path,
  ): void => {
    const value = config[prop]
    Option.match(Option.filter(Option.fromUndefinedOr(value), isStringArray), {
      onSome: (entries) => {
        config[prop] = entries.map((entry) => rewriteReferenceOrKeep(entry, tsconfigFileName, pathService))
      },
      onNone: () => undefined,
    })
  }

  const rewriteTSConfigFile = (
    project: Project,
    tsconfigFileName: string,
    pathService: Path.Path,
  ): Effect.Effect<void, PlatformError, ProjectFiles> =>
    Effect.flatMap(ProjectFiles, (files) =>
      Option.match(MutableHashMap.get(project.files, tsconfigFileName), {
        onNone: () => Effect.void,
        onSome: (tsconfigFile) =>
          Effect.flatMap(
            files.read(tsconfigFile),
            (content) =>
              Effect.matchEffect(parseTsConfig(tsconfigFileName, content), {
                onFailure: (reason) =>
                  Effect.logWarning(
                    `Could not rewrite tsconfig file "${tsconfigFileName}": ${reason}. Its extends, project references, and file array properties were not rewritten for the sandbox, so this file still points at paths outside it.`,
                  ),
                onSuccess: (config) =>
                  Effect.all(
                    [
                      rewriteExtends(config, tsconfigFileName, pathService, project),
                      rewriteProjectReferences(config, tsconfigFileName, pathService, project),
                    ],
                    { discard: true },
                  ).pipe(
                    Effect.flatMap(() =>
                      Effect.gen(function*() {
                        rewriteFileArrayProperty(config, tsconfigFileName, 'include', pathService)
                        rewriteFileArrayProperty(config, tsconfigFileName, 'exclude', pathService)
                        rewriteFileArrayProperty(config, tsconfigFileName, 'files', pathService)
                        const rewritten = yield* S.encodeEffect(S.fromJsonString(TsConfigSchema, { space: 2 }))(
                          config,
                        ).pipe(Effect.orDie)
                        Object.assign(tsconfigFile, { content: rewritten })
                      })
                    ),
                  ),
              }),
          ),
      }))

  const rewriteExtendsEntry = (
    config: TSConfig,
    extend: string,
    tsconfigFileName: string,
    pathService: Path.Path,
    project: Project,
  ): Effect.Effect<string, PlatformError, ProjectFiles> =>
    Match.value(tryRewriteReference(extend, tsconfigFileName, pathService, basePath)).pipe(
      Match.when(Predicate.isString, (rewritten) => Effect.succeed(rewritten)),
      Match.orElse(() =>
        rewriteTSConfigFile(
          project,
          pathService.resolve(pathService.dirname(tsconfigFileName), extend),
          pathService,
        ).pipe(Effect.as(extend))
      ),
    )

  const rewriteSingleExtends = (
    config: TSConfig,
    extend: string,
    tsconfigFileName: string,
    pathService: Path.Path,
    project: Project,
  ): Effect.Effect<void, PlatformError, ProjectFiles> =>
    Effect.flatMap(rewriteExtendsEntry(config, extend, tsconfigFileName, pathService, project), (rewritten) => {
      config.extends = rewritten
      return Effect.void
    })

  const rewriteExtendsArray = (
    config: TSConfig,
    extendEntries: readonly string[],
    tsconfigFileName: string,
    pathService: Path.Path,
    project: Project,
  ): Effect.Effect<void, PlatformError, ProjectFiles> =>
    Effect.forEach(extendEntries, (entry) => rewriteExtendsEntry(config, entry, tsconfigFileName, pathService, project))
      .pipe(
        Effect.flatMap((rewritten) => {
          config.extends = rewritten
          return Effect.void
        }),
      )

  const rewriteExtends = (
    config: TSConfig,
    tsconfigFileName: string,
    pathService: Path.Path,
    project: Project,
  ): Effect.Effect<void, PlatformError, ProjectFiles> =>
    Match.value(config.extends).pipe(
      Match.when(Predicate.isString, (extend) =>
        rewriteSingleExtends(config, extend, tsconfigFileName, pathService, project)),
      Match.when(S.is(ExtendsArraySchema), (extendEntries) =>
        rewriteExtendsArray(config, extendEntries, tsconfigFileName, pathService, project)),
      Match.orElse(() =>
        Effect.void
      ),
    )

  const referencedTsConfigPath = (referencePath: string) =>
    Boolean.match(referencePath.endsWith('.json'), {
      onTrue: () => referencePath,
      onFalse: () => `${referencePath}/tsconfig.json`,
    })

  const rewriteReference = (
    ref: { path: string },
    originTSConfigFileName: string,
    pathService: Path.Path,
    project: Project,
  ): Effect.Effect<void, PlatformError, ProjectFiles> =>
    Match.value(tryRewriteReference(ref.path, originTSConfigFileName, pathService, basePath)).pipe(
      Match.when(Predicate.isString, (rewritten) => {
        ref.path = rewritten
        return Effect.void
      }),
      Match.orElse(() =>
        rewriteTSConfigFile(
          project,
          pathService.resolve(pathService.dirname(originTSConfigFileName), referencedTsConfigPath(ref.path)),
          pathService,
        )
      ),
    )

  const rewriteProjectReferences = (
    config: TSConfig,
    originTSConfigFileName: string,
    pathService: Path.Path,
    project: Project,
  ): Effect.Effect<void, PlatformError, ProjectFiles> =>
    Option.match(Option.fromUndefinedOr(config.references), {
      onNone: () => Effect.void,
      onSome: (references) =>
        Effect.forEach(references, (ref) => rewriteReference(ref, originTSConfigFileName, pathService, project)).pipe(
          Effect.asVoid,
        ),
    })

  return (project) =>
    Boolean.match(options.inPlace, {
      onTrue: () => Effect.void,
      onFalse: () =>
        Effect.flatMap(Path.Path, (pathService) =>
          rewriteTSConfigFile(project, pathService.resolve(options.tsconfigFile), pathService)),
    })
}

const tryRewriteReference = (
  reference: string,
  originTSConfigFileName: string,
  pathService: Path.Path,
  basePath: string,
) => {
  const fileName = pathService.resolve(pathService.dirname(originTSConfigFileName), reference)
  const relativeToSandbox = pathService.relative(basePath, fileName)
  return Boolean.match(relativeToSandbox.startsWith('..'), {
    onTrue: () =>
      ['..', '..', Option.getOrElse(S.decodeOption(Mutant.CanonicalFileName)(reference), () => reference)].join('/'),
    onFalse: () => false as const,
  })
}

const createPreprocessor = (
  options: Options.StrykerOptions,
  basePath: string,
  registry: Format.FormatRegistry,
): FilePreprocessor =>
  combinePreprocessors([
    makeDisableTypeChecksPreprocessor(options, registry, Instrument.disableTypeChecks),
    makeTSConfigPreprocessor(options, basePath),
  ])

const toFileMap = (entries: readonly (readonly [string, string])[]): Map<string, string> => new Map(entries)

const directoryChain = (from: string, pathService: Path.Path): readonly string[] =>
  Boolean.match(pathService.dirname(from) === from, {
    onTrue: () => [from],
    onFalse: () => [from, ...directoryChain(pathService.dirname(from), pathService)],
  })

const binDirectoriesFrom = (from: string, pathService: Path.Path): string[] =>
  directoryChain(pathService.resolve(from), pathService).map((directory) =>
    pathService.join(directory, 'node_modules', '.bin')
  )

const inheritedPath = (): Effect.Effect<string> =>
  Config.String('PATH').pipe(
    Effect.option,
    Effect.map((value) => Option.getOrUndefined(value) ?? ''),
  )

const failOnBuildFailure = (
  command: string,
  result: { readonly exitCode: number; readonly stderr: string },
): Effect.Effect<void, StrykerError> =>
  Match.value(result.exitCode).pipe(
    Match.when(
      (exitCode) => exitCode !== 0,
      (exitCode) =>
        Effect.fail(
          StrykerError.make({
            message: `Build command "${command}" failed with exit code ${String(exitCode)}.\n${result.stderr}`,
          }),
        ),
    ),
    Match.orElse(() => Effect.void),
  )

const runBuildCommandIn = (
  command: string,
  workingDirectory: string,
): Effect.Effect<void, StrykerError, Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const separator = Boolean.match(pathService.sep === '\\', { onTrue: () => ';', onFalse: () => ':' })
    const inherited = yield* inheritedPath()
    const binDirs = binDirectoriesFrom(workingDirectory, pathService)
    const newPath = [...binDirs, inherited].join(separator)

    const childCommand = ChildProcess.make(command, {
      shell: true,
      cwd: workingDirectory,
      env: { PATH: newPath },
      extendEnv: true,
    })
    const result = yield* Effect.scoped(
      Effect.gen(function*() {
        const handle = yield* spawner.spawn(childCommand)
        const stderrChunks = yield* handle.stderr.pipe(
          Stream.decodeText,
          Stream.runCollect,
          Effect.map((chunks) => [...chunks].join('')),
          Effect.orElseSucceed(() => ''),
        )
        const exitCode = yield* handle.exitCode
        return { exitCode: Number(exitCode), stderr: stderrChunks }
      }),
    ).pipe(
      Effect.mapError((cause) => StrykerError.make({ message: `Failed to spawn build command "${command}"`, cause })),
    )

    yield* failOnBuildFailure(command, result)
  })

type BaseWalk = {
  readonly basePath: string
  readonly tempDirName: string | undefined
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
}

type WalkState = {
  readonly queue: ReadonlyArray<string>
  readonly found: ReadonlyArray<string>
}

type DirectoryRole = 'skipped' | 'nodeModules' | 'searchable'

const directoryRole = (dir: string, walk: BaseWalk): DirectoryRole =>
  Match.value(walk.path.basename(dir)).pipe(
    Match.when((name) => name === walk.tempDirName, (): DirectoryRole => 'skipped'),
    Match.when((name) => name === 'node_modules', (): DirectoryRole => 'nodeModules'),
    Match.orElse((): DirectoryRole => 'searchable'),
  )

const childDirectoriesOf = (dir: string, walk: BaseWalk): Effect.Effect<readonly string[], PlatformError> =>
  Effect.flatMap(
    walk.fs.readDirectory(walk.path.join(walk.basePath, dir)).pipe(Effect.orElseSucceed(() => [])),
    (entries) =>
      Effect.map(
        Effect.forEach(
          entries,
          (entry) => {
            const child = walk.path.join(dir, entry)
            return Effect.map(
              walk.fs.stat(walk.path.join(walk.basePath, child)).pipe(
                Effect.map((info) => info.type),
                Effect.orElseSucceed((): string => 'Unknown'),
              ),
              (statType) =>
                Boolean.match(statType === 'Directory', {
                  onTrue: () => Option.some(child),
                  onFalse: () => Option.none<string>(),
                }),
            )
          },
          { concurrency: 1 },
        ),
        (children) => children.filter(Option.isSome).map((some) => some.value),
      ),
  )

const visitDirectory = (dir: string, walk: BaseWalk, state: WalkState): Effect.Effect<WalkState, PlatformError> =>
  Match.value(directoryRole(dir, walk)).pipe(
    Match.when('nodeModules', () => Effect.succeed({ queue: state.queue, found: [...state.found, dir] })),
    Match.when('skipped', () => Effect.succeed(state)),
    Match.orElse(() =>
      Effect.map(childDirectoriesOf(dir, walk), (children) => ({
        queue: [...state.queue, ...children],
        found: state.found,
      }))
    ),
  )

const walkQueue = (walk: BaseWalk, state: WalkState): Effect.Effect<readonly string[], PlatformError> => {
  const last = state.queue[state.queue.length - 1]
  return Option.match(Option.fromUndefinedOr(last), {
    onNone: () => Effect.succeed(state.found),
    onSome: (dir) =>
      Effect.flatMap(
        visitDirectory(dir, walk, { queue: state.queue.slice(0, -1), found: state.found }),
        (next) => walkQueue(walk, next),
      ),
  })
}

const findNodeModulesList = (
  basePath: string,
  tempDirName: string | undefined,
): Effect.Effect<string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.map(
    Effect.gen(function*() {
      const walk: BaseWalk = {
        basePath,
        tempDirName,
        fs: yield* FileSystem.FileSystem,
        path: yield* Path.Path,
      }
      return yield* walkQueue(walk, { queue: ['.'], found: [] })
    }),
    (found) => [...found],
  )

const symlinkJunction = (
  to: string,
  from: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fsService = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    yield* fsService.makeDirectory(pathService.dirname(from), { recursive: true })
    yield* fsService.symlink(to, from)
  })

const moveEntry = (
  from: string,
  to: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const stat = yield* fs.stat(from)
    yield* Boolean.match(stat.type === 'Directory', {
      onTrue: () => moveDirectoryRecursive(from, to),
      onFalse: () =>
        fs.rename(from, to).pipe(Effect.catch(() => fs.copyFile(from, to).pipe(Effect.andThen(fs.remove(from))))),
    })
  })

const moveDirectoryRecursive = (
  from: string,
  to: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const exists = yield* fs.exists(from)
    yield* Boolean.match(exists, {
      onFalse: () => Effect.void,
      onTrue: () =>
        Effect.gen(function*() {
          yield* fs.makeDirectory(to, { recursive: true })
          const entries = yield* fs.readDirectory(from)
          yield* Effect.forEach(
            entries,
            (entry) => moveEntry(pathService.join(from, entry), pathService.join(to, entry)),
            { concurrency: 1, discard: true },
          )
          yield* fs.remove(from, { recursive: true, force: true })
        }),
    })
  })

const announceSandbox = (
  options: Options.StrykerOptions,
  workingDirectory: string,
  backupDirectory: string,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void> =>
  Boolean.match(options.inPlace, {
    onTrue: () =>
      Effect.logInfo(
        `In place mode is enabled, Stryker will be overriding YOUR files. Find your backup at: ${
          pathService.relative(basePath, backupDirectory)
        }`,
      ),
    onFalse: () => Effect.logDebug(`Creating a sandbox for files in ${workingDirectory}`),
  })

const hasBackupToRestore = (options: Options.StrykerOptions, backupDirectory: string) =>
  Boolean.match(options.inPlace, {
    onTrue: () => backupDirectory !== '',
    onFalse: () => false,
  })

const restoreOriginalFiles = (
  workingDirectory: string,
  backupDirectory: string,
  basePath: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.addFinalizer(() =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const p = yield* Path.Path
      const exists = yield* fs.exists(backupDirectory)
      yield* Boolean.match(exists, {
        onFalse: () => Effect.void,
        onTrue: () =>
          Effect.logInfo(`Resetting your original files from ${p.relative(basePath, backupDirectory)}.`).pipe(
            Effect.andThen(moveDirectoryRecursive(backupDirectory, workingDirectory).pipe(Effect.orDie)),
          ),
      })
    }).pipe(Effect.orDie)
  )

const isNonEmptyString = (value: string | undefined): value is string => value !== undefined && value !== ''

const runConfiguredBuild = (
  options: Options.StrykerOptions,
  workingDirectory: string,
): Effect.Effect<void, StrykerError, Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Match.value(options.buildCommand).pipe(
    Match.when(
      isNonEmptyString,
      (command) =>
        Effect.logInfo(`Running build command "${command}" in "${workingDirectory}".`).pipe(
          Effect.andThen(() => runBuildCommandIn(command, workingDirectory)),
        ),
    ),
    Match.orElse(() => Effect.void),
  )

const linksNodeModules = (options: Options.StrykerOptions) =>
  Boolean.match(options.symlinkNodeModules, {
    onTrue: () => !options.inPlace,
    onFalse: () => false,
  })

const linkNodeModules = (
  nodeModules: string,
  workingDirectory: string,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const resolvedTo = pathService.resolve(pathService.join(basePath, nodeModules))
    const resolvedFrom = pathService.join(workingDirectory, nodeModules)
    yield* Effect.logDebug(`Create symlink from ${resolvedTo} to ${resolvedFrom}`)
    yield* symlinkJunction(resolvedTo, resolvedFrom).pipe(
      Effect.tapError(() =>
        Effect.logWarning(
          `Unexpected error while trying to symlink "${nodeModules}" in sandbox directory.`,
        )
      ),
      Effect.catchTag('PlatformError', () => Effect.void),
    )
  })

const linkFoundNodeModules = (
  options: Options.StrykerOptions,
  workingDirectory: string,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(
    findNodeModulesList(basePath, options.tempDirName),
    (nodeModulesList) =>
      Boolean.match(nodeModulesList.length === 0, {
        onTrue: () =>
          Effect.logDebug(
            `Could not find a node_modules folder to symlink into the sandbox directory. Search "${basePath}" and its parent directories`,
          ),
        onFalse: () =>
          Effect.forEach(
            nodeModulesList,
            (nodeModules) => linkNodeModules(nodeModules, workingDirectory, basePath, pathService),
            { concurrency: 1, discard: true },
          ),
      }),
  )

const symlinkNodeModules = (
  options: Options.StrykerOptions,
  workingDirectory: string,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    yield* Effect.logDebug('Start symlink node_modules')
    yield* Boolean.match(linksNodeModules(options), {
      onTrue: () => linkFoundNodeModules(options, workingDirectory, basePath, pathService),
      onFalse: () => Effect.void,
    })
  })

const acquireSandbox = (state: {
  readonly spec: MakeSandboxInput
  readonly preprocessors: readonly FilePreprocessor[]
}): Effect.Effect<
  SandboxHandle,
  PlatformError | StrykerError,
  | FileSystem.FileSystem
  | Path.Path
  | ProjectFiles
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope
> =>
  Effect.gen(function*() {
    const { options, project, workingDirectory, backupDirectory, basePath } = state.spec
    yield* Scope.Scope
    const pathService = yield* Path.Path

    yield* announceSandbox(options, workingDirectory, backupDirectory, basePath, pathService)
    yield* Effect.when(
      restoreOriginalFiles(workingDirectory, backupDirectory, basePath),
      Effect.succeed(hasBackupToRestore(options, backupDirectory)),
    )
    const preprocessor = combinePreprocessors([
      createPreprocessor(options, basePath, state.spec.formatRegistry),
      ...state.preprocessors,
    ])
    yield* preprocessor(project).pipe(
      Effect.mapError((cause) => StrykerError.make({ message: 'Sandbox preprocessor failed', cause })),
    )
    const files = yield* ProjectFiles
    const entries = yield* Boolean.match(options.inPlace, {
      onTrue: () => files.writeAllInPlace([...project.files], { backupDirectory, basePath }),
      onFalse: () => files.writeAllToSandbox([...project.files], { workingDirectory, basePath }),
    })
    const fileMap = toFileMap(entries)

    yield* runConfiguredBuild(options, workingDirectory)
    yield* symlinkNodeModules(options, workingDirectory, basePath, pathService)
    return makeHandle({ fileMap, workingDirectory, basePath, pathService })
  })

export const TypeId = Symbol.for('@systemfsoftware/stryker-js/Sandbox')
export type TypeId = typeof TypeId

export interface SandboxResource extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly spec: MakeSandboxInput
  withPreprocessor(preprocessor: FilePreprocessor): SandboxResource
  readonly scoped: Effect.Effect<
    SandboxHandle,
    PlatformError | StrykerError,
    | FileSystem.FileSystem
    | Path.Path
    | ProjectFiles
    | ChildProcessSpawner.ChildProcessSpawner
    | Scope.Scope
  >
  layer<Id>(
    service: Context.Key<Id, SandboxHandle>,
  ): Layer.Layer<
    Id,
    PlatformError | StrykerError,
    | FileSystem.FileSystem
    | Path.Path
    | ProjectFiles
    | ChildProcessSpawner.ChildProcessSpawner
  >
}

const makeProto = (state: {
  readonly spec: MakeSandboxInput
  readonly preprocessors: readonly FilePreprocessor[]
}): SandboxResource => {
  const self: SandboxResource = {
    [TypeId]: TypeId,
    spec: state.spec,
    ...Prototype,
    withPreprocessor(preprocessor: FilePreprocessor): SandboxResource {
      return makeProto({ spec: state.spec, preprocessors: [...state.preprocessors, preprocessor] })
    },
    get scoped() {
      return acquireSandbox(state)
    },
    layer<Id>(
      service: Context.Key<Id, SandboxHandle>,
    ): Layer.Layer<
      Id,
      PlatformError | StrykerError,
      | FileSystem.FileSystem
      | Path.Path
      | ProjectFiles
      | ChildProcessSpawner.ChildProcessSpawner
    > {
      return Layer.effect(service)(acquireSandbox(state))
    },
  }
  return self
}

export const make = (spec: MakeSandboxInput): SandboxResource => makeProto({ spec, preprocessors: [] })

export const withPreprocessor: {
  (preprocessor: FilePreprocessor): (self: SandboxResource) => SandboxResource
  (self: SandboxResource, preprocessor: FilePreprocessor): SandboxResource
} = dual(2, (self: SandboxResource, preprocessor: FilePreprocessor) => self.withPreprocessor(preprocessor))

export const makeSandbox = (
  input: MakeSandboxInput,
): Effect.Effect<
  SandboxHandle,
  PlatformError | StrykerError,
  | FileSystem.FileSystem
  | Path.Path
  | ProjectFiles
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope
> => make(input).scoped
