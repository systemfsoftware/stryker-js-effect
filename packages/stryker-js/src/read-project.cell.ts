/// <reference types="vitest/importMeta" />
import type { FileDescriptions, MutateDescription } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutationTestResult, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Boolean, Schema as S } from 'effect'
import * as Effect from 'effect/Effect'
import * as Equivalence from 'effect/Equivalence'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { badArgument, type PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'

import { admitIncrementalReport, AdmitIncrementalReportCommand } from './admit-incremental-report.workflow.js'
import { defaultOptions } from './config-defaults.js'
import { IgnoreRule } from './matching.schema.js'
import { IncrementalReportSchema } from './IncrementalReport.schema.js'
import { MutationRangeSpecifierSchema, type MutationRangeSpecifier } from './MutationRange.schema.js'
import type { Project, ProjectFile } from './Project.schema.js'
import { strykerVersion } from './stryker-package.js'

const ALWAYS_IGNORE = Object.freeze([
  'node_modules',
  '.git',
  '*.tsbuildinfo',
  '/stryker.log',
  '.next',
  '.nuxt',
  '.svelte-kit',
])

const IGNORE_PATTERN_CHARACTER = '!'

const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

type Location = {
  readonly start: { readonly line: number; readonly column: number }
  readonly end: { readonly line: number; readonly column: number }
}

type FileMutate = boolean | readonly Location[]

type FileDescriptionLike = { readonly mutate: FileMutate }

interface FileSelectionInput {
  readonly inputFileNames: readonly string[]
  readonly mutatePatterns: readonly string[]
  readonly targetMutatePatterns?: readonly string[]
  readonly testFilePatterns: readonly string[]
  readonly basePath: string
}

interface SelectedFiles {
  readonly fileDescriptions: Record<string, { readonly mutate: boolean | readonly Location[] }>
  readonly testFiles: readonly string[]
}

const normalizeFileName = (value: string) => value.replace(/\\/g, '/')

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type GlobStep = {
  readonly consumed: number
  readonly output: string
}

const consumeDoubleStar = (pattern: string, index: number): GlobStep =>
  Boolean.match(pattern[index + 2] === '/', {
    onTrue: () => ({ consumed: 3, output: '(?:.*\\/)?' }),
    onFalse: () => ({ consumed: 2, output: '.*' }),
  })

const consumeStar = (pattern: string, index: number): GlobStep =>
  Boolean.match(pattern[index + 1] === '*', {
    onTrue: () => consumeDoubleStar(pattern, index),
    onFalse: () => ({ consumed: 1, output: '[^/]*' }),
  })

const consumeBrace = (pattern: string, index: number): GlobStep => {
  const close = pattern.indexOf('}', index)
  return Boolean.match(close === -1, {
    onTrue: () => ({ consumed: 1, output: '\\{' }),
    onFalse: () => {
      const escaped = pattern.slice(index + 1, close).split(',').map((part) => escapeRegExp(part))
      return { consumed: close - index + 1, output: `(${escaped.join('|')})` }
    },
  })
}

const consumeCharClass = (pattern: string, index: number): GlobStep => {
  const close = pattern.indexOf(']', index)
  return Boolean.match(close === -1, {
    onTrue: () => ({ consumed: 1, output: '\\[' }),
    onFalse: () => ({ consumed: close - index + 1, output: pattern.slice(index, close + 1) }),
  })
}

const consumeGlobChar = (pattern: string, index: number): GlobStep =>
  Match.value(pattern[index]).pipe(
    Match.when('*', () => consumeStar(pattern, index)),
    Match.when('?', () => ({ consumed: 1, output: '[^/]' })),
    Match.when('{', () => consumeBrace(pattern, index)),
    Match.when('[', () => consumeCharClass(pattern, index)),
    Match.orElse(() => ({
      consumed: 1,
      output: escapeRegExp(Option.getOrElse(Option.fromUndefinedOr(pattern[index]), () => '')),
    })),
  )

const globCharsToRegExp = (pattern: string): string =>
  Boolean.match(pattern.length === 0, {
    onTrue: () => '',
    onFalse: () => {
      const step = consumeGlobChar(pattern, 0)
      return `${step.output}${globCharsToRegExp(pattern.slice(step.consumed))}`
    },
  })

const globToRegExp = (pattern: string) => new RegExp(`^${globCharsToRegExp(pattern)}$`)

const trimTrailingSlashes = (value: string) => {
  const trimmed = value.replace(/\/+$/, '')
  return Boolean.match(trimmed.length === 0, {
    onTrue: () => value.slice(0, 1),
    onFalse: () => trimmed,
  })
}

const resolveAgainstBase = (basePath: string, pattern: string) => {
  const normalized = normalizeFileName(pattern)
  const base = trimTrailingSlashes(normalizeFileName(basePath))
  return Boolean.match(normalized.startsWith('/'), {
    onTrue: () => normalized,
    onFalse: () =>
      `${base}/${Boolean.match(normalized.startsWith('./'), {
        onTrue: () => normalized.slice(2),
        onFalse: () => normalized,
      })}`,
  })
}

const globPatternOf = (pattern: boolean | string) =>
  Match.value(pattern).pipe(
    Match.when(Match.string, (value) => normalizeFileName(value)),
    Match.when(true, () => DEFAULT_GLOB),
    Match.orElse(() => undefined),
  )

const hasHiddenSegment = (fileName: string, base: string) => {
  const relative = Boolean.match(fileName.startsWith(base), {
    onTrue: () => fileName.slice(base.length),
    onFalse: () => fileName,
  })
  return relative.split('/').some((segment) => segment.startsWith('.'))
}

const isExcludedHiddenFile = (normalizedFile: string, base: string, allowHiddenFiles: boolean, patternHasDot: boolean) =>
  Boolean.match(allowHiddenFiles, {
    onTrue: () => false,
    onFalse: () =>
      Boolean.match(hasHiddenSegment(normalizedFile, base), {
        onTrue: () => !patternHasDot,
        onFalse: () => false,
      }),
  })

const createPureMatcher = (pattern: boolean | string, allowHiddenFiles: boolean, basePath: string) =>
  Match.value(globPatternOf(pattern)).pipe(
    Match.when(undefined, () => (): boolean => false),
    Match.orElse((relative) => {
      const regex = globToRegExp(resolveAgainstBase(basePath, relative))
      const patternHasDot = relative.includes('.')
      const base = `${trimTrailingSlashes(normalizeFileName(basePath))}/`
      return (fileName: string) => {
        const normalizedFile = normalizeFileName(fileName)
        return Boolean.match(isExcludedHiddenFile(normalizedFile, base, allowHiddenFiles, patternHasDot), {
          onTrue: () => false,
          onFalse: () => regex.test(normalizedFile),
        })
      }
    }),
  )

const rangeListOf = (mutate: FileMutate) =>
  Option.filter(Option.fromUndefinedOr(mutate), (value): value is readonly Location[] => Array.isArray(value))

const unionPair = (first: FileDescriptionLike, second: FileDescriptionLike) => {
  const ranges = Option.all([rangeListOf(first.mutate), rangeListOf(second.mutate)])
  return Option.match(ranges, {
    onSome: ([firstRanges, secondRanges]) => ({ mutate: [...secondRanges, ...firstRanges] }),
    onNone: () =>
      Boolean.match(second.mutate === true, {
        onTrue: () => ({ mutate: true as const }),
        onFalse: () =>
          Boolean.match(first.mutate === false, {
            onTrue: () => ({ mutate: second.mutate }),
            onFalse: () => ({ mutate: first.mutate }),
          }),
      }),
  })
}

const unionDescription = (first: FileDescriptionLike, second: FileDescriptionLike | undefined) =>
  Option.match(Option.fromUndefinedOr(second), {
    onNone: () => first,
    onSome: (defined) => unionPair(first, defined),
  })

const overlapOf = (firstRange: Location, secondRange: Location) => {
  const startLine = Math.max(firstRange.start.line, secondRange.start.line)
  const endLine = Math.min(firstRange.end.line, secondRange.end.line)
  const startColumn = Boolean.match(firstRange.start.line === startLine, {
    onTrue: () => firstRange.start.column,
    onFalse: () => secondRange.start.column,
  })
  const endColumn = Boolean.match(firstRange.end.line === endLine, {
    onTrue: () => firstRange.end.column,
    onFalse: () => secondRange.end.column,
  })
  return Boolean.match(startLine > endLine, {
    onTrue: () => undefined,
    onFalse: () => ({
      start: { line: startLine, column: startColumn },
      end: { line: endLine, column: endColumn },
    }),
  })
}

const isLocation = (value: Location | undefined): value is Location => value !== undefined

const overlapRanges = (firstRanges: readonly Location[], secondRanges: readonly Location[]) =>
  firstRanges
    .flatMap((firstRange) => secondRanges.map((secondRange) => overlapOf(firstRange, secondRange)))
    .filter(isLocation)

const intersectFileDescriptions = (first: FileDescriptionLike, second: FileDescriptionLike) => {
  const ranges = Option.all([rangeListOf(first.mutate), rangeListOf(second.mutate)])
  return Option.match(ranges, {
    onSome: ([firstRanges, secondRanges]) => ({ mutate: overlapRanges(firstRanges, secondRanges) }),
    onNone: () =>
      Boolean.match(first.mutate === true, {
        onTrue: () => second,
        onFalse: () =>
          Boolean.match(second.mutate === true, {
            onTrue: () => first,
            onFalse: () => ({ mutate: false as const }),
          }),
      }),
  })
}

const columnOf = (column: number | undefined, fallback: number) => column ?? fallback

const spanOf = (specifier: MutationRangeSpecifier) => ({
  start: { line: specifier.startLine - 1, column: columnOf(specifier.startColumn, 0) },
  end: { line: specifier.endLine - 1, column: columnOf(specifier.endColumn, Number.MAX_SAFE_INTEGER) },
})

const mutationRangeOf = (mutatePattern: string) =>
  Option.map(S.decodeOption(MutationRangeSpecifierSchema)(mutatePattern), (specifier) => ({
    pattern: specifier.file,
    mutate: [spanOf(specifier)],
  }))

const describeMatchingFiles = (fileNames: Iterable<string>, pattern: string, mutate: FileMutate, basePath: string) =>
  HashMap.fromIterable(
    Array.from(fileNames)
      .filter(createPureMatcher(pattern, false, basePath))
      .map((fileName): readonly [string, FileDescriptionLike] => [fileName, { mutate }]),
  )

const filterMutatePatternPure = (fileNames: Iterable<string>, mutatePattern: string, basePath: string) =>
  Option.match(mutationRangeOf(mutatePattern), {
    onNone: () => describeMatchingFiles(fileNames, mutatePattern, true, basePath),
    onSome: (range) => describeMatchingFiles(fileNames, range.pattern, range.mutate, basePath),
  })

const applyMutatePattern = (
  selected: HashMap.HashMap<string, FileDescriptionLike>,
  pattern: string,
  inputFileNames: readonly string[],
  basePath: string,
): HashMap.HashMap<string, FileDescriptionLike> => {
  const isExclusion = pattern.startsWith(IGNORE_PATTERN_CHARACTER)
  return Boolean.match(isExclusion, {
    onTrue: () => {
      const matched = filterMutatePatternPure(HashMap.keys(selected), pattern.substring(1), basePath)
      return Array.from(HashMap.keys(matched)).reduce(
        (inner, fileName) => HashMap.set(inner, fileName, { mutate: false as const }),
        selected,
      )
    },
    onFalse: () => {
      const matched = filterMutatePatternPure(inputFileNames, pattern, basePath)
      return HashMap.reduce(matched, selected, (inner, description, fileName) =>
        Option.match(HashMap.get(inner, fileName), {
          onNone: () => HashMap.set(inner, fileName, unionDescription(description, undefined)),
          onSome: (existing) => HashMap.set(inner, fileName, unionDescription(description, existing)),
        }))
    },
  })
}

const intersectTarget = (
  seen: HashMap.HashMap<string, FileDescriptionLike>,
  afterMutate: HashMap.HashMap<string, FileDescriptionLike>,
  pattern: string,
  basePath: string,
) => {
  const matched = filterMutatePatternPure(HashMap.keys(afterMutate), pattern, basePath)
  return HashMap.reduce(matched, seen, (innerSeen, description, fileName) =>
    Option.match(HashMap.get(afterMutate, fileName), {
      onNone: () => innerSeen,
      onSome: (current) => {
        const intersected = intersectFileDescriptions(current, description)
        const alreadySeen = Option.getOrElse(HashMap.get(innerSeen, fileName), () => undefined)
        return HashMap.set(innerSeen, fileName, unionDescription(intersected, alreadySeen))
      },
    }))
}

const restrictToTargets = (
  afterMutate: HashMap.HashMap<string, FileDescriptionLike>,
  targetMutatePatterns: readonly string[],
  basePath: string,
) => {
  const seen = targetMutatePatterns.reduce(
    (inner, pattern) => intersectTarget(inner, afterMutate, pattern, basePath),
    HashMap.empty<string, FileDescriptionLike>(),
  )
  const final = HashMap.reduce(
    afterMutate,
    HashMap.empty<string, FileDescriptionLike>(),
    (acc, _description, fileName) =>
      Option.match(HashMap.get(seen, fileName), {
        onNone: () => HashMap.set(acc, fileName, { mutate: false as const }),
        onSome: (seenValue) => HashMap.set(acc, fileName, seenValue),
      }),
  )
  return final
}

const resolveFileDescriptionsPure = (
  inputFileNames: readonly string[],
  mutatePatterns: readonly string[],
  targetMutatePatterns: readonly string[] | undefined,
  basePath: string,
) => {
  const initial = HashMap.fromIterable(
    inputFileNames.map((name): readonly [string, FileDescriptionLike] => [name, { mutate: false as const }]),
  )
  const afterMutate = mutatePatterns.reduce(
    (files, pattern) => applyMutatePattern(files, pattern, inputFileNames, basePath),
    initial,
  )
  return Option.match(Option.fromUndefinedOr(targetMutatePatterns), {
    onNone: () => Object.fromEntries(afterMutate),
    onSome: (targets) => Object.fromEntries(restrictToTargets(afterMutate, targets, basePath)),
  })
}

const resolveTestFilesPure = (inputFileNames: readonly string[], testFilePatterns: readonly string[], basePath: string) =>
  Boolean.match(testFilePatterns.length === 0, {
    onTrue: (): readonly string[] => [],
    onFalse: () =>
      Array.from(HashSet.fromIterable(testFilePatterns.flatMap((pattern) =>
        Array.from(inputFileNames).filter(createPureMatcher(pattern, false, basePath))
      ))),
  })

const selectFiles = (input: FileSelectionInput): SelectedFiles => ({
  fileDescriptions: resolveFileDescriptionsPure(
    input.inputFileNames,
    input.mutatePatterns,
    input.targetMutatePatterns,
    input.basePath,
  ),
  testFiles: resolveTestFilesPure(input.inputFileNames, input.testFilePatterns, input.basePath),
})

const stringArrayEquivalence = Equivalence.Array(Equivalence.String)

type ReadProjectInput = {
  readonly options: StrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly basePath: string
}

const ignoreRulesOf = (options: StrykerOptions) => [
  ...ALWAYS_IGNORE,
  options.tempDirName,
  options.incrementalFile,
  options.progressStreamFile,
  options.htmlReporter.fileName,
  options.jsonReporter.fileName,
  ...options.ignorePatterns,
]

const directoryPrefixOf = (relativeName: string) =>
  Boolean.match(relativeName.length > 0, {
    onTrue: () => `${relativeName}/`,
    onFalse: () => '',
  })

const matchesDirectoryPartially = (entryPath: string, rule: IgnoreRule) =>
  rule.matchesPrefix(`/${entryPath}`) || rule.matchesPrefix(entryPath)

const matchesFileCandidate = (entryName: string, entryPath: string, rule: IgnoreRule) =>
  [entryName, entryPath, `/${entryPath}`].some((candidate) => rule.matches(candidate))

const matchesDirectoryTail = (entryPath: string, rule: IgnoreRule) =>
  [rule.matches(`/${entryPath}/`), rule.matches(`${entryPath}/`)].some((matched) => matched)

const matchesNegatedDirectory = (entryPath: string, rule: IgnoreRule) =>
  rule.negate && matchesDirectoryPartially(entryPath, rule)

const matchesDirectory = (entryName: string, entryPath: string, rule: IgnoreRule) =>
  [
    matchesFileCandidate(entryName, entryPath, rule),
    matchesDirectoryTail(entryPath, rule),
    matchesNegatedDirectory(entryPath, rule),
  ].some((matched) => matched)

const applyIgnoreRule = (included: boolean, negate: boolean, matches: () => boolean) =>
  Boolean.match(negate, {
    onTrue: () => included,
    onFalse: () =>
      Boolean.match(matches(), {
        onTrue: () => negate,
        onFalse: () => included,
      }),
  })

const isIncluded = (ignoreRules: readonly IgnoreRule[], name: string, entryPath: string, isDirectory: boolean) =>
  ignoreRules.reduce(
    (included, rule) =>
      applyIgnoreRule(included, rule.negate, () =>
        Boolean.match(isDirectory, {
          onTrue: () => matchesDirectory(name, entryPath, rule),
          onFalse: () => matchesFileCandidate(name, entryPath, rule),
        })),
    true,
  )

type DirectoryEntry = {
  readonly name: string
  readonly full: string
  readonly isDirectory: boolean
  readonly entryPath: string
}

const crawlDir = (
  ignoreRules: readonly IgnoreRule[],
  dir: string,
  rootDir: string,
): Effect.Effect<string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const entries = yield* fs.readDirectory(dir)
    const prefix = directoryPrefixOf(pathService.relative(rootDir, dir))
    const withTypes = yield* Effect.forEach(
      entries,
      (name) => {
        const full = pathService.join(dir, name)
        return Effect.map(
          fs.stat(full).pipe(
            Effect.map((info) => info.type === 'Directory'),
            Effect.orElseSucceed(() => false),
          ),
          (isDirectory): DirectoryEntry => ({ name, full, isDirectory, entryPath: `${prefix}${name}` }),
        )
      },
      { concurrency: 256 },
    )
    return yield* Effect.forEach(
      withTypes.filter(({ name, entryPath, isDirectory }) => isIncluded(ignoreRules, name, entryPath, isDirectory)),
      (entry) =>
        Boolean.match(entry.isDirectory, {
          onTrue: () => crawlDir(ignoreRules, entry.full, rootDir),
          onFalse: () => Effect.succeed([entry.full]),
        }),
      { concurrency: 256 },
    ).pipe(Effect.map((files) => files.flat()))
  })

const resolveInputFileNames = (
  ignoreRules: readonly string[],
  basePath: string,
): Effect.Effect<string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  crawlDir(ignoreRules.map((pattern) => Effect.runSync(IgnoreRule.decode(pattern))), basePath, basePath)

const selectionOf = (
  inputFileNames: readonly string[],
  mutatePatterns: readonly string[],
  testFilePatterns: readonly string[],
  basePath: string,
  targetMutatePatterns: readonly string[] | undefined,
): FileSelectionInput =>
  Option.match(Option.fromUndefinedOr(targetMutatePatterns), {
    onNone: () => ({ inputFileNames, mutatePatterns, testFilePatterns, basePath }),
    onSome: (targets) => ({
      inputFileNames,
      mutatePatterns,
      testFilePatterns,
      basePath,
      targetMutatePatterns: targets,
    }),
  })

const warnUnmatchedMutatePattern = (
  inputFileNames: readonly string[],
  basePath: string,
  pattern: string,
): Effect.Effect<void> => {
  const excluding = pattern.startsWith(IGNORE_PATTERN_CHARACTER)
  const inner = Boolean.match(excluding, { onTrue: () => pattern.substring(1), onFalse: () => pattern })
  const probed = selectFiles({
    inputFileNames,
    mutatePatterns: [inner],
    testFilePatterns: [],
    basePath,
  })
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
  const probed = selectFiles({
    inputFileNames,
    mutatePatterns: [],
    testFilePatterns: [pattern],
    basePath,
  })
  return Boolean.match(probed.testFiles.length === 0, {
    onTrue: () => Effect.logWarning(`Glob pattern "${pattern}" did not match any test files.`),
    onFalse: () => Effect.void,
  })
}

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
  options: StrykerOptions,
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

type ReadProjectCommand = (typeof AdmitIncrementalReportCommand)['Encoded'] & {
  readonly options: StrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly basePath: string
  readonly incremental: boolean
  readonly incrementalFile: string
  readonly contents: string | undefined
  readonly fileDescriptions: SelectedFiles['fileDescriptions']
  readonly testFiles: readonly string[]
}

const addProjectFile = (
  files: MutableHashMap.MutableHashMap<string, ProjectFile>,
  filesToMutate: MutableHashMap.MutableHashMap<string, ProjectFile>,
  name: string,
  desc: { readonly mutate: MutateDescription },
): void => {
  const file: ProjectFile = { name, mutate: desc.mutate, content: undefined, originalContent: undefined }
  MutableHashMap.set(files, name, file)
  Boolean.match(desc.mutate === false, {
    onTrue: () => undefined,
    onFalse: () => MutableHashMap.set(filesToMutate, name, file),
  })
}

const makeProject = (
  fileDescriptions: FileDescriptions,
  incrementalReport?: MutationTestResult,
  testFiles: readonly string[] = [],
): Project => {
  const files: MutableHashMap.MutableHashMap<string, ProjectFile> = MutableHashMap.empty<string, ProjectFile>()
  const filesToMutate: MutableHashMap.MutableHashMap<string, ProjectFile> = MutableHashMap.empty<string, ProjectFile>()
  Object.entries(fileDescriptions).forEach(([name, desc]) => addProjectFile(files, filesToMutate, name, desc))
  return {
    fileDescriptions,
    incrementalReport,
    testFiles,
    files,
    filesToMutate,
  }
}

const readProjectCommand = (input: ReadProjectInput) =>
  Effect.gen(function*() {
    const mutatePatterns: readonly string[] = input.options.mutate
    const testFilePatterns: readonly string[] = input.options.testFiles
    const inputFileNames = yield* resolveInputFileNames(ignoreRulesOf(input.options), input.basePath)
    const defaults = yield* defaultOptions
    const decision = selectFiles(
      selectionOf(inputFileNames, mutatePatterns, testFilePatterns, input.basePath, input.targetMutatePatterns),
    )
    yield* Boolean.match(stringArrayEquivalence(mutatePatterns, defaults.mutate), {
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
    return Object.assign(
      AdmitIncrementalReportCommand.make({ report: reportOf(contents), expectedVersion: strykerVersion }),
      {
        options: input.options,
        targetMutatePatterns: input.targetMutatePatterns,
        basePath: input.basePath,
        incremental: input.options.incremental,
        incrementalFile: input.options.incrementalFile,
        contents,
        fileDescriptions: decision.fileDescriptions,
        testFiles: [...decision.testFiles],
      },
    )
  })

const discardLogOf = (
  command: ReadProjectCommand,
  discard: { readonly actual?: string | undefined; readonly expected: string },
): Effect.Effect<void> =>
  Boolean.match(command.incremental, {
    onFalse: () => Effect.void,
    onTrue: () =>
      Option.match(Option.fromUndefinedOr(command.contents), {
        onNone: () => Effect.void,
        onSome: () =>
          Option.match(Option.fromUndefinedOr(discard.actual), {
            onNone: () =>
              Effect.logInfo(
                `Unable to parse incremental result file at ${command.incrementalFile}; a full mutation testing run will be performed.`,
              ),
            onSome: (actual) =>
              Effect.logInfo(
                `Incremental result file at ${command.incrementalFile} version ${actual} does not match expected version ${discard.expected}; a full mutation testing run will be performed.`,
              ),
          }),
      }),
  })

export interface ReadProjectDone {
  readonly options: StrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly basePath: string
  readonly project: Project
}

const projectOf = (command: ReadProjectCommand, report: MutationTestResult | undefined): ReadProjectDone => ({
  options: command.options,
  targetMutatePatterns: command.targetMutatePatterns,
  basePath: command.basePath,
  project: makeProject(command.fileDescriptions, report, command.testFiles),
})

export const readProjectCell = Sandwich.named('stryker.project_read')(readProjectCommand)
  .decide(admitIncrementalReport)
  .write({
    IncrementalReportKeep: (keep, command) => Effect.succeed(projectOf(command, keep.report)),
    IncrementalReportDiscard: (discard, command) =>
      Effect.as(discardLogOf(command, discard), projectOf(command, undefined)),
    CommandRejected: ({ issue }) =>
      Effect.fail(badArgument({ module: 'stryker-js', method: 'incremental-report.cell', description: issue })),
  })

const rangeLawHolds = (startLine: number, endLine: number, column: number) => {
  const expectedSpanOf = (startColumn: number, endColumn: number) => ({
    pattern: 'src/a.ts',
    mutate: [{ start: { line: startLine - 1, column: startColumn }, end: { line: endLine - 1, column: endColumn } }],
  })
  const caseHolds = (pattern: string, startColumn: number, endColumn: number) =>
    JSON.stringify(Option.getOrUndefined(mutationRangeOf(pattern))) === JSON.stringify(expectedSpanOf(startColumn, endColumn))
  return ([
    [`src/a.ts:${startLine}:${column}-${endLine}:${column}`, column, column],
    [`src/a.ts:${startLine}:${column}-${endLine}`, column, Number.MAX_SAFE_INTEGER],
    [`src/a.ts:${startLine}-${endLine}:${column}`, 0, column],
    [`src/a.ts:${startLine}-${endLine}`, 0, Number.MAX_SAFE_INTEGER],
  ] as const).every(([pattern, startColumn, endColumn]) => caseHolds(pattern, startColumn, endColumn))
}

const exclusionLawHolds = (files: readonly string[], include: string, exclude: string) => {
  const selected = selectFiles({
    inputFileNames: files,
    mutatePatterns: [include, `!${exclude}`],
    testFilePatterns: [],
    basePath: '/',
  })
  const includeMatcher = createPureMatcher(include, false, '/')
  const excludeMatcher = createPureMatcher(exclude, false, '/')
  return files.every((fileName) => {
    const description = selected.fileDescriptions[fileName]
    const expected = Boolean.match(excludeMatcher(fileName), {
      onTrue: () => false,
      onFalse: () => includeMatcher(fileName),
    })
    return description !== undefined && description.mutate === expected
  })
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')

  const FileBatchSchema = Schema.Array(Schema.String.pipe(Schema.check(Schema.isMaxLength(64))))
  const GlobSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))
  const LineSchema = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })))
  const ColumnSchema = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 10_000 })))

  it.prop(
    '∀files_P_Excluded_≡RemovedFromSelection',
    [FileBatchSchema, GlobSchema, GlobSchema],
    ([files, include, exclude]) => exclusionLawHolds(files, include, exclude),
  )

  it.prop(
    '∀startLine_endLine_col_Range_≡ZeroBasedSpan',
    [LineSchema, LineSchema, ColumnSchema],
    ([startLine, endLine, column]) => rangeLawHolds(startLine, endLine, column),
  )

  it.prop(
    '∀files_P_Target_≡IntersectedSelection',
    [FileBatchSchema, GlobSchema],
    ([files, target]) => {
      const selected = selectFiles({
        inputFileNames: files,
        mutatePatterns: ['**/*'],
        targetMutatePatterns: [target],
        testFilePatterns: [],
        basePath: '/',
      })
      const matcher = createPureMatcher(target, false, '/')
      return files.every((fileName) => {
        const description = selected.fileDescriptions[fileName]
        return description === undefined || description.mutate === matcher(fileName)
      })
    },
  )
}

