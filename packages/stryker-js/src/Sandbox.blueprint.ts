import { Blueprint } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Format, Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Boolean } from 'effect'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { matchesFile } from './FileMatcher.js'
import { FileMatcher } from './matching.schema.js'
import { ProjectFiles } from './project-files.service.js'
import { type Project, withPreprocessedFiles } from './Project.schema.js'
import { sandboxTsconfigCell } from './sandbox-tsconfig.cell.js'
import { make as makeHandle, type SandboxHandle } from './Sandbox.handle.js'
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
) => Effect.Effect<Project, PlatformError | StrykerError, FileSystem.FileSystem | Path.Path | ProjectFiles>

const combinePreprocessors = (preprocessors: readonly FilePreprocessor[]): FilePreprocessor => (project) =>
  Effect.reduce(preprocessors, () => project, (current, preprocess) => preprocess(current))

const makeDisableTypeChecksPreprocessor = (options: Options.StrykerOptions, registry: Format.FormatRegistry) =>
  Effect.fn(SpanTaxonomy.Spans.sandboxPreprocessDisableTypeChecks.name)(function*(project: Project) {
    const pathService = yield* Path.Path
    const files = yield* ProjectFiles
    const matcher = FileMatcher.make({ pattern: options.disableTypeChecks, allowHiddenFiles: true })
    const matched = [...project.files.values()].filter((file) => matchesFile(matcher, pathService, file.name))
    const instrumented = yield* files.readAll(matched)
    const updates = yield* Effect.forEach(
      instrumented,
      ([file, content]) =>
        Effect.map(
          Instrument.disableTypeChecks({ content, mutate: file.mutate, name: file.name }, registry).pipe(
            Effect.map((instrumentedFile) => instrumentedFile.content),
            Effect.mapError((cause) => StrykerError.make({ message: 'disableTypeChecks failed', cause })),
          ),
          (text) => ({ ...file, content: text }),
        ),
      { concurrency: 'unbounded' },
    )
    return withPreprocessedFiles(project, updates)
  })

const rewriteTsconfigTree = (
  project: Project,
  fileName: string,
  basePath: string,
): Effect.Effect<Project, PlatformError | StrykerError, Path.Path | ProjectFiles> =>
  Effect.flatMap(sandboxTsconfigCell.run({ project, fileName, basePath }), ({ rewritten, follow }) =>
    Effect.map(
      Effect.reduce(follow, () => project, (current, followed) => rewriteTsconfigTree(current, followed, basePath)),
      (followedProject) => withPreprocessedFiles(followedProject, Option.toArray(rewritten)),
    ))

const makeTSConfigPreprocessor = (options: Options.StrykerOptions, basePath: string): FilePreprocessor => (project) =>
  Boolean.match(options.inPlace, {
    onTrue: () => Effect.succeed(project),
    onFalse: () =>
      Effect.flatMap(
        Path.Path,
        (pathService) => rewriteTsconfigTree(project, pathService.resolve(options.tsconfigFile), basePath),
      ),
  })

const createPreprocessor = (
  options: Options.StrykerOptions,
  basePath: string,
  registry: Format.FormatRegistry,
): FilePreprocessor =>
  combinePreprocessors([
    makeDisableTypeChecksPreprocessor(options, registry),
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

const runBuildCommandIn = Effect.fn(SpanTaxonomy.Spans.sandboxBuildRun.name)(function*(
  command: string,
  workingDirectory: string,
): Effect.fn.Return<void, StrykerError, Path.Path | ChildProcessSpawner.ChildProcessSpawner> {
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

type WalkStep = {
  readonly emit: readonly string[]
  readonly children: readonly string[]
}

const walkStep = (dir: string, walk: BaseWalk): Effect.Effect<WalkStep, PlatformError> =>
  Match.value(directoryRole(dir, walk)).pipe(
    Match.when('nodeModules', () => Effect.succeed({ emit: [dir], children: [] })),
    Match.when('skipped', () => Effect.succeed({ emit: [], children: [] })),
    Match.orElse(() => Effect.map(childDirectoriesOf(dir, walk), (children) => ({ emit: [], children }))),
  )

const nodeModulesStream = (walk: BaseWalk): Stream.Stream<string, PlatformError> =>
  Stream.paginate<string[], string, PlatformError, never>(
    ['.'],
    (queue) =>
      Option.match(Option.fromUndefinedOr(queue[queue.length - 1]), {
        onNone: () => Effect.succeed<readonly [ReadonlyArray<string>, Option.Option<string[]>]>([[], Option.none()]),
        onSome: (dir) =>
          Effect.map(walkStep(dir, walk), ({ emit, children }) =>
            [
              emit,
              Option.some([...queue.slice(0, -1), ...children]),
            ] as const),
      }),
  )

const findNodeModulesList = Effect.fn(SpanTaxonomy.Spans.sandboxFindNodeModules.name)(function*(
  basePath: string,
  tempDirName: string | undefined,
): Effect.fn.Return<string[], PlatformError, FileSystem.FileSystem | Path.Path> {
  const walk: BaseWalk = {
    basePath,
    tempDirName,
    fs: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
  }
  const found = yield* Stream.runCollect(nodeModulesStream(walk))
  return [...found]
})

const symlinkJunction = Effect.fn(SpanTaxonomy.Spans.sandboxSymlinkJunction.name)(function*(
  to: string,
  from: string,
): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem | Path.Path> {
  const fsService = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  yield* fsService.makeDirectory(pathService.dirname(from), { recursive: true })
  yield* fsService.symlink(to, from)
})

const moveEntry = Effect.fn(SpanTaxonomy.Spans.sandboxMoveEntry.name)(function*(
  from: string,
  to: string,
): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem
  const stat = yield* fs.stat(from)
  yield* Boolean.match(stat.type === 'Directory', {
    onTrue: () => moveDirectoryRecursive(from, to),
    onFalse: () =>
      fs.rename(from, to).pipe(Effect.catch(() => fs.copyFile(from, to).pipe(Effect.andThen(fs.remove(from))))),
  })
})

const moveDirectoryContents = Effect.fn(SpanTaxonomy.Spans.sandboxMoveDirectoryContents.name)(function*(
  from: string,
  to: string,
) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  yield* fs.makeDirectory(to, { recursive: true })
  const entries = yield* fs.readDirectory(from)
  yield* Stream.fromIterable(entries).pipe(
    Stream.mapEffect((entry) => moveEntry(pathService.join(from, entry), pathService.join(to, entry))),
    Stream.runDrain,
  )
  yield* fs.remove(from, { recursive: true, force: true })
})

const moveDirectoryRecursive = Effect.fn(SpanTaxonomy.Spans.sandboxMoveDirectory.name)(function*(
  from: string,
  to: string,
): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem
  const exists = yield* fs.exists(from)
  yield* Boolean.match(exists, {
    onFalse: () => Effect.void,
    onTrue: () => moveDirectoryContents(from, to),
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

const restoreFromBackup = Effect.fn(SpanTaxonomy.Spans.sandboxRestoreOriginal.name)(function*(
  backupDirectory: string,
  workingDirectory: string,
  basePath: string,
) {
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
})

const restoreOriginalFiles = (
  workingDirectory: string,
  backupDirectory: string,
  basePath: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.addFinalizer(() => restoreFromBackup(backupDirectory, workingDirectory, basePath).pipe(Effect.orDie))

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

const linkNodeModules = Effect.fn(SpanTaxonomy.Spans.sandboxLinkNodeModules.name)(function*(
  nodeModules: string,
  workingDirectory: string,
  basePath: string,
  pathService: Path.Path,
): Effect.fn.Return<void, never, FileSystem.FileSystem | Path.Path> {
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

const symlinkNodeModules = Effect.fn(SpanTaxonomy.Spans.sandboxSymlinkNodeModules.name)(function*(
  options: Options.StrykerOptions,
  workingDirectory: string,
  basePath: string,
  pathService: Path.Path,
): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem | Path.Path> {
  yield* Effect.logDebug('Start symlink node_modules')
  yield* Boolean.match(linksNodeModules(options), {
    onTrue: () => linkFoundNodeModules(options, workingDirectory, basePath, pathService),
    onFalse: () => Effect.void,
  })
})

export interface SandboxSpec extends MakeSandboxInput {
  readonly preprocessors: readonly FilePreprocessor[]
}

const acquireSandbox = Effect.fn(SpanTaxonomy.Spans.sandboxAcquire.name)(function*(spec: SandboxSpec) {
  const { options, project, workingDirectory, backupDirectory, basePath } = spec
  yield* Scope.Scope
  const pathService = yield* Path.Path

  yield* announceSandbox(options, workingDirectory, backupDirectory, basePath, pathService)
  yield* Effect.when(
    restoreOriginalFiles(workingDirectory, backupDirectory, basePath),
    Effect.succeed(hasBackupToRestore(options, backupDirectory)),
  )
  const preprocessor = combinePreprocessors([
    createPreprocessor(options, basePath, spec.formatRegistry),
    ...spec.preprocessors,
  ])
  const preprocessed = yield* preprocessor(project).pipe(
    Effect.mapError((cause) => StrykerError.make({ message: 'Sandbox preprocessor failed', cause })),
  )
  const files = yield* ProjectFiles
  const entries = yield* Boolean.match(options.inPlace, {
    onTrue: () => files.writeAllInPlace(preprocessed.files, { backupDirectory, basePath }),
    onFalse: () => files.writeAllToSandbox(preprocessed.files, { workingDirectory, basePath }),
  })
  const fileMap = toFileMap(entries)

  yield* runConfiguredBuild(options, workingDirectory)
  yield* symlinkNodeModules(options, workingDirectory, basePath, pathService)
  return makeHandle({ fileMap, workingDirectory, basePath, pathService })
})

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/Sandbox')
export type TypeId = typeof TypeId

export const Sandboxes = Blueprint.make<SandboxSpec>()(TypeId).steps({
  steps: {
    withPreprocessor: (spec: SandboxSpec, preprocessor: FilePreprocessor): SandboxSpec => ({
      ...spec,
      preprocessors: [...spec.preprocessors, preprocessor],
    }),
  },
  targets: {
    scoped: (spec: SandboxSpec): Effect.Effect<
      SandboxHandle,
      PlatformError | StrykerError,
      | FileSystem.FileSystem
      | Path.Path
      | ProjectFiles
      | ChildProcessSpawner.ChildProcessSpawner
      | Scope.Scope
    > => acquireSandbox(spec),
    layer: (
      spec: SandboxSpec,
    ): <Id>(service: Context.Key<Id, SandboxHandle>) => Layer.Layer<
      Id,
      PlatformError | StrykerError,
      | FileSystem.FileSystem
      | Path.Path
      | ProjectFiles
      | ChildProcessSpawner.ChildProcessSpawner
    > =>
    <Id>(service: Context.Key<Id, SandboxHandle>) => Layer.effect(service)(acquireSandbox(spec)),
  },
})

export type SandboxResource = Blueprint.Of<typeof Sandboxes>

export const make = (spec: MakeSandboxInput): SandboxResource => Sandboxes.of({ ...spec, preprocessors: [] })

export const withPreprocessor = Sandboxes.operations.withPreprocessor

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
