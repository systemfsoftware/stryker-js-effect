import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Boolean, Schema as S } from 'effect'
import * as Effect from 'effect/Effect'
import * as Equivalence from 'effect/Equivalence'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import { badArgument } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'

import { admitDiscoveredEntry, DiscoveredEntryCommand, EntryIncluded } from './admit-discovered-entry.workflow.js'
import {
  admitIncrementalReport,
  AdmitIncrementalReportCommand,
  IncrementalReportDiscard,
} from './admit-incremental-report.workflow.js'
import { defaultOptions } from './config/default-options.js'
import { DiffScopeCommand, type DiffScopeDecision, FullScope } from './git-diff.schema.js'
import { GitDiff } from './git-diff.service.js'
import { gitDiff } from './git-diff.workflow.js'
import { type IncrementalReport, IncrementalReportSchema } from './IncrementalReport.schema.js'
import type { Project, ProjectFile } from './Project.schema.js'
import { ProjectFilesDiscovered, ProjectSelectionCommand, selectProjectFiles } from './select-project-files.workflow.js'
import { strykerOutputFilesOf } from './stryker-outputs.js'
import { engineDigestOf, INCREMENTAL_CACHE_VERSION, runInputsDigestOf } from './verdict-semantics.js'

const ALWAYS_IGNORE = Object.freeze([
  'node_modules',
  '.git',
  '*.tsbuildinfo',
  '/stryker.log',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
])

const CRAWL_CONCURRENCY = 256

type DiscardReason = IncrementalReportDiscard['reason']

interface IncrementalReportDiscardShape {
  readonly reason: DiscardReason
  readonly actual?: string | undefined
  readonly expected: string
}

const DISCARD_TEXTS: Readonly<
  Record<DiscardReason, (command: ReadProjectCommand, discard: IncrementalReportDiscardShape) => string>
> = {
  noPriorRecord: (command) =>
    `Unable to parse incremental result file at ${command.incrementalFile}${
      Option.match(Option.fromUndefinedOr(command.decodeError), {
        onNone: () => '',
        onSome: (error) => `: ${error}`,
      })
    }; a full mutation testing run will be performed.`,
  cacheLayoutChanged: (command, discard) =>
    `Incremental result file at ${command.incrementalFile} has cache layout version ${
      discard.actual ?? ''
    }, expected ${discard.expected}; a full mutation testing run will be performed.`,
  semanticsChanged: (command, discard) =>
    `Incremental result file at ${command.incrementalFile} was written by the engine with digest ${
      discard.actual ?? ''
    }, expected ${discard.expected}; a full mutation testing run will be performed.`,
  policyChanged: (command, discard) =>
    `Incremental result file at ${command.incrementalFile} has mutant-set policy ${
      discard.actual ?? ''
    }, expected ${discard.expected}; a full mutation testing run will be performed.`,
  runInputsChanged: (command) =>
    `Run inputs changed since the incremental result file at ${command.incrementalFile} was written; a full mutation testing run will be performed.`,
}

const discardMessageOf = (
  command: ReadProjectCommand,
  discard: IncrementalReportDiscardShape,
): Option.Option<string> =>
  Option.map(
    Option.filter(Option.fromUndefinedOr(command.contents), () => command.incremental),
    () => DISCARD_TEXTS[discard.reason](command, discard),
  )

const discardLogOf: (input: {
  readonly command: ReadProjectCommand
  readonly discard: IncrementalReportDiscardShape
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

const insideProjectOnlyRuleOf = (relative: string, absoluteFallback: string): string =>
  Option.getOrElse(
    Option.liftPredicate(relative, (value) => value.length > 0 && !value.startsWith('..')),
    () => absoluteFallback,
  )

const projectRelativeRuleOf = (basePath: string, pathService: Path.Path, rule: string): string =>
  Boolean.match(pathService.isAbsolute(rule), {
    onTrue: () => insideProjectOnlyRuleOf(pathService.relative(pathService.resolve(basePath), rule), rule),
    onFalse: () => rule,
  })

const ignoreRulesOf = (
  options: Options.StrykerOptions,
  basePath: string,
  pathService: Path.Path,
): readonly string[] => [
  ...ALWAYS_IGNORE,
  ...strykerOutputFilesOf(options).map((file) => projectRelativeRuleOf(basePath, pathService, file)),
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

const decodeFailureText = (failure: S.SchemaError): string => failure.message.replace(/\s+/gu, ' ').trim()

interface IncrementalReportRead {
  readonly report?: IncrementalReport | undefined
  readonly decodeError?: string | undefined
}

const reportReadOf = (contents: string | undefined): IncrementalReportRead =>
  Option.match(Option.fromUndefinedOr(contents), {
    onNone: (): IncrementalReportRead => ({}),
    onSome: (text) =>
      Result.match(parseAndDecodeIncrementalReport(text), {
        onFailure: (failure): IncrementalReportRead => ({ decodeError: decodeFailureText(failure) }),
        onSuccess: (report): IncrementalReportRead => ({ report }),
      }),
  })

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

interface DiffScope {
  readonly scope: 'diff' | 'full'
  readonly diffRanges: readonly string[] | undefined
}

const FULL_SCOPE: DiffScope = { scope: 'full', diffRanges: undefined }

const diffScopeOf = Effect.fnUntraced(function*(ref: string, basePath: string) {
  const git = yield* GitDiff
  const result = yield* git.changedSince({ cwd: basePath, ref })
  const decision: DiffScopeDecision = Result.match(
    gitDiff(DiffScopeCommand.make({ hunks: [...result.hunks], untrackedFiles: [...result.untrackedFiles] })),
    { onFailure: () => FullScope.make({ reason: 'the diff could not be computed' }), onSuccess: (value) => value },
  )
  return yield* Match.value(decision).pipe(
    Match.tag(
      'DiffScoped',
      (scoped): Effect.Effect<DiffScope> => Effect.succeed({ scope: 'diff', diffRanges: [...scoped.ranges] }),
    ),
    Match.tag(
      'FullScope',
      (full): Effect.Effect<DiffScope> =>
        Effect.as(Effect.logWarning(`Diff scope fell back to a full run: ${full.reason}.`), FULL_SCOPE),
    ),
    Match.exhaustive,
  )
})

const effectiveOptions = (scope: DiffScope, options: Options.StrykerOptions): Options.StrykerOptions => {
  const { since, ...withoutSince } = options
  return Boolean.match(scope.scope === 'full', {
    onTrue: () => (since === undefined ? options : withoutSince),
    onFalse: () => options,
  })
}

type ReadProjectCommand = (typeof AdmitIncrementalReportCommand)['Encoded'] & {
  readonly options: Options.StrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly basePath: string
  readonly incremental: boolean
  readonly incrementalFile: string
  readonly contents: string | undefined
  readonly decodeError: string | undefined
  readonly fileDescriptions: Record<string, { readonly mutate: Instrument.MutateDescription }>
  readonly testFiles: readonly string[]
}

const readProject = Effect.fn(SpanTaxonomy.Spans.projectReadFromDisk.name)(function*(input: ReadProjectInput) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const diffScope = yield* Option.match(Option.fromUndefinedOr(input.options.since), {
    onNone: () => Effect.succeed(FULL_SCOPE),
    onSome: (ref) => diffScopeOf(ref, input.basePath),
  })
  const options = effectiveOptions(diffScope, input.options)
  const mutatePatterns: readonly string[] = options.mutate
  const { testFileIgnores, testFilePatterns } = testFileSelectionOf(options)
  const inputFileNames = yield* resolveInputFileNames(
    ignoreRulesOf(options, input.basePath, pathService),
    input.basePath,
  )
  const defaults = yield* defaultOptions
  const decision = selectedOf(
    ProjectSelectionCommand.make({
      inputFileNames,
      mutatePatterns: [...mutatePatterns],
      targetMutatePatterns: Option.getOrUndefined(
        Option.map(Option.fromUndefinedOr(input.targetMutatePatterns), (targets) => [...targets]),
      ),
      diffRanges: Option.getOrUndefined(Option.fromUndefinedOr(diffScope.diffRanges)),
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
  const runInputsDigest = yield* runInputsDigestOf(fs, pathService, input.basePath, options)
  const contents = Option.getOrUndefined(yield* incrementalContentsOf(fs, options))
  const reportRead = reportReadOf(contents)
  const command: ReadProjectCommand = {
    _tag: 'AdmitIncrementalReportCommand',
    report: reportRead.report,
    expectedIncrementalVersion: INCREMENTAL_CACHE_VERSION,
    engineDigest: yield* engineDigestOf(fs, pathService),
    mutantSetPolicy: options.mutator.mutantSetPolicy,
    runInputsDigest,
    options,
    targetMutatePatterns: input.targetMutatePatterns,
    basePath: input.basePath,
    incremental: options.incremental,
    incrementalFile: options.incrementalFile,
    contents,
    decodeError: reportRead.decodeError,
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
  readonly incrementalReportDiscard?: IncrementalReportDiscard | undefined
}

const projectFileOf = (name: string, desc: { readonly mutate: Instrument.MutateDescription }): ProjectFile => ({
  name,
  mutate: desc.mutate,
  content: undefined,
  originalContent: undefined,
})

const makeProject = (
  fileDescriptions: Instrument.FileDescriptions,
  incrementalReport?: IncrementalReport,
  testFiles: readonly string[] = [],
): Project => {
  const files = Object.entries(fileDescriptions).map(([name, desc]) => projectFileOf(name, desc))
  return {
    fileDescriptions,
    incrementalReport,
    testFiles,
    files: new Map(files.map((file) => [file.name, file] as const)),
    filesToMutate: new Map(files.filter((file) => file.mutate !== false).map((file) => [file.name, file] as const)),
  }
}

const projectOf = ({
  command,
  report,
  discard,
}: {
  readonly command: ReadProjectCommand
  readonly report: IncrementalReport | undefined
  readonly discard?: IncrementalReportDiscard | undefined
}): ReadProjectDone => ({
  options: command.options,
  targetMutatePatterns: command.targetMutatePatterns,
  basePath: command.basePath,
  project: makeProject(command.fileDescriptions, report, command.testFiles),
  incrementalReportDiscard: discard,
})

const discardInstanceOf = (discard: IncrementalReportDiscardShape): IncrementalReportDiscard =>
  IncrementalReportDiscard.make({
    reason: discard.reason,
    expected: discard.expected,
    actual: discard.actual,
  })

export const readProjectCell = Sandwich.named(SpanTaxonomy.Spans.projectRead.name)(readProject)
  .decide(admitIncrementalReport)
  .write({
    IncrementalReportKeep: (keep, command) => Effect.succeed(projectOf({ command, report: keep.report })),
    IncrementalReportDiscard: (discard, command) =>
      Effect.as(
        discardLogOf({ command, discard }),
        projectOf({ command, report: undefined, discard: discardInstanceOf(discard) }),
      ),
    CommandRejected: ({ issue }) =>
      Effect.fail(badArgument({ module: 'stryker-js', method: 'incremental-report.cell', description: issue })),
  })
