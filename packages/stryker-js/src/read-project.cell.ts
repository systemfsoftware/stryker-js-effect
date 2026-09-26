import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Boolean, Schema as S } from 'effect'
import * as Effect from 'effect/Effect'
import * as Equivalence from 'effect/Equivalence'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import { badArgument } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'

import { admitDiscoveredEntry, DiscoveredEntryCommand, EntryIncluded } from './admit-discovered-entry.workflow.js'
import { admitIncrementalReport, AdmitIncrementalReportCommand } from './admit-incremental-report.workflow.js'
import { defaultOptions } from './config/default-options.js'
import { type IncrementalReport, IncrementalReportSchema } from './IncrementalReport.schema.js'
import type { Project, ProjectFile } from './Project.schema.js'
import { ProjectFilesDiscovered, ProjectSelectionCommand, selectProjectFiles } from './select-project-files.workflow.js'
import { StrykerPackage } from './stryker-package.schema.js'

const ALWAYS_IGNORE = Object.freeze([
  'node_modules',
  '.git',
  '*.tsbuildinfo',
  '/stryker.log',
  '.next',
  '.nuxt',
  '.svelte-kit',
])

const CRAWL_CONCURRENCY = 256

const discardMessageOf = (
  command: ReadProjectCommand,
  discard: { readonly actual?: string | undefined; readonly expected: string },
): Option.Option<string> =>
  Option.map(Option.filter(Option.fromUndefinedOr(command.contents), () => command.incremental), () =>
    Option.getOrElse(
      Option.map(
        Option.fromUndefinedOr(discard.actual),
        (actual) =>
          `Incremental result file at ${command.incrementalFile} version ${actual} does not match expected version ${discard.expected}; a full mutation testing run will be performed.`,
      ),
      () =>
        `Unable to parse incremental result file at ${command.incrementalFile}; a full mutation testing run will be performed.`,
    ))

const discardLogOf: (input: {
  readonly command: ReadProjectCommand
  readonly discard: { readonly actual?: string | undefined; readonly expected: string }
}) => Effect.Effect<void> = ({ command, discard }) =>
  Option.getOrElse(
    Option.map(discardMessageOf(command, discard), (message) => Effect.logInfo(message)),
    () => Effect.void,
  )

type ReadProjectInput = {
  readonly options: Options.StrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly basePath: string
}

const ignoreRulesOf = (options: Options.StrykerOptions) => [
  ...ALWAYS_IGNORE,
  options.tempDirName,
  options.incrementalFile,
  options.progressStreamFile,
  options.htmlReporter.fileName,
  options.jsonReporter.fileName,
  ...options.ignorePatterns,
]

const directoryPrefixOf = (relativeName: string) =>
  Boolean.match(relativeName.length > 0, { onTrue: () => `${relativeName}/`, onFalse: () => '' })

type DirectoryEntry = {
  readonly name: string
  readonly full: string
  readonly isDirectory: boolean
  readonly entryPath: string
}

const crawlDirectory = (
  ignorePatterns: readonly string[],
  dir: string,
  rootDir: string,
): Stream.Stream<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Stream.unwrap(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const entries = yield* fs.readDirectory(dir)
      const prefix = directoryPrefixOf(pathService.relative(rootDir, dir))
      const withTypes = yield* Stream.fromIterable(entries).pipe(
        Stream.mapEffect(
          (name): Effect.Effect<DirectoryEntry, never, never> => {
            const full = pathService.join(dir, name)
            const entryPath = `${prefix}${name}`
            return fs.stat(full).pipe(
              Effect.map((info) => ({ name, full, isDirectory: info.type === 'Directory', entryPath })),
              Effect.orElseSucceed(() => ({ name, full, isDirectory: false, entryPath })),
            )
          },
          { concurrency: CRAWL_CONCURRENCY },
        ),
        Stream.runCollect,
      )
      return Stream.fromIterable([...withTypes]).pipe(
        Stream.filter((entry) => isEntryIncluded(ignorePatterns, entry)),
        Stream.flatMap(
          (entry) =>
            Boolean.match(entry.isDirectory, {
              onTrue: () => crawlDirectory(ignorePatterns, entry.full, rootDir),
              onFalse: () => Stream.succeed(entry.full),
            }),
          { concurrency: CRAWL_CONCURRENCY },
        ),
      )
    }),
  )

const isEntryIncluded = (ignorePatterns: readonly string[], entry: DirectoryEntry): boolean => {
  const decision = admitDiscoveredEntry(
    DiscoveredEntryCommand.make({
      ignorePatterns: [...ignorePatterns],
      entryName: entry.name,
      entryPath: entry.entryPath,
      isDirectory: entry.isDirectory,
    }),
  )
  return Option.exists(Result.getSuccess(decision), S.is(EntryIncluded))
}

const resolveInputFileNames = (
  ignorePatterns: readonly string[],
  basePath: string,
): Effect.Effect<string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  crawlDirectory(ignorePatterns, basePath, basePath).pipe(Stream.runCollect, Effect.map((files) => [...files]))

const parseAndDecodeIncrementalReport = S.decodeUnknownResult(S.fromJsonString(IncrementalReportSchema))

const reportOf = (contents: string | undefined) =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.fromUndefinedOr(contents),
      (text) => Result.getSuccess(parseAndDecodeIncrementalReport(text)),
    ),
  )

const incrementalContentsOf = (
  fs: FileSystem.FileSystem,
  options: Options.StrykerOptions,
): Effect.Effect<Option.Option<string>, PlatformError> =>
  Boolean.match(options.incremental, {
    onFalse: () => Effect.succeedNone,
    onTrue: () =>
      fs.readFileString(options.incrementalFile).pipe(
        Effect.asSome,
        Effect.tapError((error) =>
          Match.value(error.reason).pipe(
            Match.tag('NotFound', () =>
              Effect.logInfo(
                `No incremental result file found at ${options.incrementalFile}, a full mutation testing run will be performed.`,
              )),
            Match.orElse(() => Effect.void),
          )
        ),
        Effect.catchTag('PlatformError', (error) =>
          Match.value(error.reason).pipe(
            Match.tag('NotFound', () => Effect.succeedNone),
            Match.orElse(() => Effect.fail(error)),
          )),
      ),
  })

const testFileSelectionOf = (
  options: Pick<Options.StrykerOptions, 'testFiles'>,
): { readonly testFilePatterns: readonly string[]; readonly testFileIgnores: readonly string[] } => ({
  testFilePatterns: options.testFiles,
  testFileIgnores: [],
})

const selectedOf = (command: ProjectSelectionCommand) =>
  Option.getOrElse(
    Option.map(
      Option.filter(Result.getSuccess(selectProjectFiles(command)), S.is(ProjectFilesDiscovered)),
      (discovered) => ({
        fileDescriptions: discovered.fileDescriptions,
        testFiles: [...discovered.testFiles],
      }),
    ),
    () => ({ fileDescriptions: {}, testFiles: [] }),
  )

const warnUnmatchedMutatePattern = (
  inputFileNames: readonly string[],
  basePath: string,
  pattern: string,
): Effect.Effect<void> => {
  const excluding = pattern.startsWith('!')
  const inner = Boolean.match(excluding, { onTrue: () => pattern.substring(1), onFalse: () => pattern })
  const probed = selectedOf(
    ProjectSelectionCommand.make({
      inputFileNames: [...inputFileNames],
      mutatePatterns: [inner],
      testFilePatterns: [],
      basePath,
    }),
  )
  return Boolean.match(Object.keys(probed.fileDescriptions).length > 0, {
    onTrue: () => Effect.void,
    onFalse: () =>
      Effect.logWarning(
        Boolean.match(excluding, {
          onTrue: () => `Glob pattern "${pattern}" did not exclude any files.`,
          onFalse: () => `Glob pattern "${pattern}" did not result in any files.`,
        }),
      ),
  })
}

const warnUnmatchedTestPattern = (
  inputFileNames: readonly string[],
  basePath: string,
  pattern: string,
): Effect.Effect<void> => {
  const probed = selectedOf(
    ProjectSelectionCommand.make({
      inputFileNames: [...inputFileNames],
      mutatePatterns: [],
      testFilePatterns: [pattern],
      basePath,
    }),
  )
  return Boolean.match(probed.testFiles.length === 0, {
    onTrue: () => Effect.logWarning(`Glob pattern "${pattern}" did not match any test files.`),
    onFalse: () => Effect.void,
  })
}

const stringArrayEquivalence = Equivalence.Array(Equivalence.String)

type ReadProjectCommand = (typeof AdmitIncrementalReportCommand)['Encoded'] & {
  readonly options: Options.StrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly basePath: string
  readonly incremental: boolean
  readonly incrementalFile: string
  readonly contents: string | undefined
  readonly fileDescriptions: Record<string, { readonly mutate: Instrument.MutateDescription }>
  readonly testFiles: readonly string[]
}

export const readProject = Effect.fn('stryker.project.read')(function*(input: ReadProjectInput) {
  const mutatePatterns: readonly string[] = input.options.mutate
  const { testFileIgnores, testFilePatterns } = testFileSelectionOf(input.options)
  const inputFileNames = yield* resolveInputFileNames(ignoreRulesOf(input.options), input.basePath)
  const defaults = yield* defaultOptions
  const decision = selectedOf(
    ProjectSelectionCommand.make({
      inputFileNames,
      mutatePatterns: [...mutatePatterns],
      targetMutatePatterns: Option.getOrUndefined(
        Option.map(Option.fromUndefinedOr(input.targetMutatePatterns), (targets) => [...targets]),
      ),
      testFilePatterns: [...testFilePatterns],
      testFileIgnores: [...testFileIgnores],
      basePath: input.basePath,
    }),
  )
  yield* Boolean.match(stringArrayEquivalence([...mutatePatterns], [...defaults.mutate]), {
    onTrue: () => Effect.void,
    onFalse: () =>
      Effect.forEach(
        mutatePatterns,
        (pattern) => warnUnmatchedMutatePattern(inputFileNames, input.basePath, pattern),
        { discard: true },
      ),
  })
  yield* Effect.forEach(
    testFilePatterns,
    (pattern) => warnUnmatchedTestPattern(inputFileNames, input.basePath, pattern),
    { discard: true },
  )
  const fs = yield* FileSystem.FileSystem
  const contents = Option.getOrUndefined(yield* incrementalContentsOf(fs, input.options))
  const command: ReadProjectCommand = {
    _tag: 'AdmitIncrementalReportCommand',
    report: reportOf(contents),
    expectedVersion: StrykerPackage.version,
    options: input.options,
    targetMutatePatterns: input.targetMutatePatterns,
    basePath: input.basePath,
    incremental: input.options.incremental,
    incrementalFile: input.options.incrementalFile,
    contents,
    fileDescriptions: decision.fileDescriptions,
    testFiles: [...decision.testFiles],
  }
  return command
})

export interface ReadProjectDone {
  readonly options: Options.StrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly basePath: string
  readonly project: Project
}

const addProjectFile = (
  files: MutableHashMap.MutableHashMap<string, ProjectFile>,
  filesToMutate: MutableHashMap.MutableHashMap<string, ProjectFile>,
  name: string,
  desc: { readonly mutate: Instrument.MutateDescription },
): void => {
  const file: ProjectFile = { name, mutate: desc.mutate, content: undefined, originalContent: undefined }
  MutableHashMap.set(files, name, file)
  const settable = [filesToMutate].filter(() => desc.mutate !== false)
  settable.forEach((target) => MutableHashMap.set(target, name, file))
  const removable = [filesToMutate].filter(() => desc.mutate === false)
  removable.forEach((target) => MutableHashMap.remove(target, name))
}

const makeProject = (
  fileDescriptions: Instrument.FileDescriptions,
  incrementalReport?: IncrementalReport,
  testFiles: readonly string[] = [],
): Project => {
  const files: MutableHashMap.MutableHashMap<string, ProjectFile> = MutableHashMap.empty<string, ProjectFile>()
  const filesToMutate: MutableHashMap.MutableHashMap<string, ProjectFile> = MutableHashMap.empty<string, ProjectFile>()
  Object.entries(fileDescriptions).forEach(([name, desc]) => addProjectFile(files, filesToMutate, name, desc))
  return { fileDescriptions, incrementalReport, testFiles, files, filesToMutate }
}

export const projectOf = ({
  command,
  report,
}: {
  readonly command: ReadProjectCommand
  readonly report: IncrementalReport | undefined
}): ReadProjectDone => ({
  options: command.options,
  targetMutatePatterns: command.targetMutatePatterns,
  basePath: command.basePath,
  project: makeProject(command.fileDescriptions, report, command.testFiles),
})

export const readProjectCell = Sandwich.named('stryker.project_read')(readProject)
  .decide(admitIncrementalReport)
  .write({
    IncrementalReportKeep: (keep, command) => Effect.succeed(projectOf({ command, report: keep.report })),
    IncrementalReportDiscard: (discard, command) =>
      Effect.as(discardLogOf({ command, discard }), projectOf({ command, report: undefined })),
    CommandRejected: ({ issue }) =>
      Effect.fail(badArgument({ module: 'stryker-js', method: 'incremental-report.cell', description: issue })),
  })
