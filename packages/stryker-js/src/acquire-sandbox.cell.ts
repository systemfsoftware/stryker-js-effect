import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Format, Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { matchesFile } from './FileMatcher.js'
import { linkNodeModulesCell, type LinkNodeModulesInput } from './link-node-modules.cell.js'
import { FileMatcher } from './matching.schema.js'
import { planSandboxAcquisition } from './plan-sandbox-acquisition.workflow.js'
import { ProjectFiles } from './project-files.service.js'
import { type Project, withPreprocessedFiles } from './Project.schema.js'
import { sandboxBuildCell, type SandboxBuildInput } from './sandbox-build.cell.js'
import { sandboxTsconfigCell } from './sandbox-tsconfig.cell.js'
import { make as makeHandle, type SandboxHandle } from './Sandbox.handle.js'
import type { FilePreprocessor, SandboxSpec } from './Sandbox.schema.js'
import { StrykerError } from './stryker-error.schema.js'

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
  Effect.flatMap(
    Path.Path,
    (pathService) => rewriteTsconfigTree(project, pathService.resolve(options.tsconfigFile), basePath),
  )

const preprocess = (spec: SandboxSpec, builtins: readonly FilePreprocessor[]) =>
  combinePreprocessors([...builtins, ...spec.preprocessors])(spec.project).pipe(
    Effect.mapError((cause) => StrykerError.make({ message: 'Sandbox preprocessor failed', cause })),
  )

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
  spec: SandboxSpec,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.addFinalizer(() =>
    restoreFromBackup(spec.backupDirectory, spec.workingDirectory, spec.basePath).pipe(Effect.orDie)
  )

interface PreparedSandbox {
  readonly handle: SandboxHandle
  readonly build: Option.Option<SandboxBuildInput>
  readonly link: Option.Option<LinkNodeModulesInput>
}

const preparedOf = (
  spec: SandboxSpec,
  entries: readonly (readonly [string, string])[],
  buildCommand: Option.Option<string>,
  link: Option.Option<LinkNodeModulesInput>,
): Effect.Effect<PreparedSandbox, never, Path.Path> =>
  Effect.map(Path.Path, (pathService) => ({
    handle: makeHandle({
      fileMap: new Map(entries),
      workingDirectory: spec.workingDirectory,
      basePath: spec.basePath,
      pathService,
    }),
    build: Option.map(buildCommand, (command) => ({ command, workingDirectory: spec.workingDirectory })),
    link,
  }))

const linkInputOf = (spec: SandboxSpec): LinkNodeModulesInput => ({
  basePath: spec.basePath,
  workingDirectory: spec.workingDirectory,
  tempDirName: spec.options.tempDirName,
})

const readAcquisition = (spec: SandboxSpec) =>
  Effect.succeed({
    _tag: 'SandboxAcquisitionCommand' as const,
    inPlace: spec.options.inPlace,
    backupDirectory: spec.backupDirectory,
    symlinkNodeModules: spec.options.symlinkNodeModules,
    buildCommand: spec.options.buildCommand,
    spec,
  })

const inPlaceSandbox = (
  spec: SandboxSpec,
  buildCommand: Option.Option<string>,
  restore: Effect.Effect<void, never, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    yield* Effect.logInfo(
      `In place mode is enabled, Stryker will be overriding YOUR files. Find your backup at: ${
        pathService.relative(spec.basePath, spec.backupDirectory)
      }`,
    )
    yield* restore
    const preprocessed = yield* preprocess(spec, [
      makeDisableTypeChecksPreprocessor(spec.options, spec.formatRegistry),
    ])
    const files = yield* ProjectFiles
    const entries = yield* files.writeAllInPlace(preprocessed.files, {
      backupDirectory: spec.backupDirectory,
      basePath: spec.basePath,
    })
    return yield* preparedOf(spec, entries, buildCommand, Option.none())
  })

const copiedSandbox = (
  spec: SandboxSpec,
  buildCommand: Option.Option<string>,
  link: Option.Option<LinkNodeModulesInput>,
) =>
  Effect.gen(function*() {
    yield* Effect.logDebug(`Creating a sandbox for files in ${spec.workingDirectory}`)
    const preprocessed = yield* preprocess(spec, [
      makeDisableTypeChecksPreprocessor(spec.options, spec.formatRegistry),
      makeTSConfigPreprocessor(spec.options, spec.basePath),
    ])
    const files = yield* ProjectFiles
    const entries = yield* files.writeAllToSandbox(preprocessed.files, {
      workingDirectory: spec.workingDirectory,
      basePath: spec.basePath,
    })
    return yield* preparedOf(spec, entries, buildCommand, link)
  })

const prepareSandboxCell = Sandwich.named(SpanTaxonomy.Spans.sandboxAcquire.name)(readAcquisition)
  .decide(planSandboxAcquisition)
  .write({
    SandboxInPlaceRestored: ({ buildCommand }, { spec }) =>
      inPlaceSandbox(spec, buildCommand, restoreOriginalFiles(spec)),
    SandboxInPlaceUnrestored: ({ buildCommand }, { spec }) => inPlaceSandbox(spec, buildCommand, Effect.void),
    SandboxCopiedLinked: ({ buildCommand }, { spec }) =>
      copiedSandbox(spec, buildCommand, Option.some(linkInputOf(spec))),
    SandboxCopiedUnlinked: ({ buildCommand }, { spec }) => copiedSandbox(spec, buildCommand, Option.none()),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `Could not decide how to acquire the sandbox: ${issue}` })),
  })

const keepingPrepared = <B, E, R>(step: Cell.Cell<PreparedSandbox, B, E, R>) =>
  Cell.id<PreparedSandbox>().pipe(Cell.zipWith(step, (prepared: PreparedSandbox) => prepared))

const buildStep = Cell.id<PreparedSandbox>().pipe(
  Cell.map((prepared) => prepared.build),
  Cell.gate(sandboxBuildCell),
)

const linkStep = Cell.id<PreparedSandbox>().pipe(
  Cell.map((prepared) => prepared.link),
  Cell.gate(linkNodeModulesCell),
)

export const acquireSandboxCell: Cell.Cell<
  SandboxSpec,
  SandboxHandle,
  PlatformError | StrykerError,
  | FileSystem.FileSystem
  | Path.Path
  | ProjectFiles
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope
> = prepareSandboxCell.pipe(
  Cell.andThen(keepingPrepared(buildStep)),
  Cell.andThen(keepingPrepared(linkStep)),
  Cell.map((prepared) => prepared.handle),
)
