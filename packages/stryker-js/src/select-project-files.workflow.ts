import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Boolean } from 'effect'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type MutationRangeSpecifier, MutationRangeSpecifierSchema } from './MutationRange.schema.js'

const ProjectSelectionTypeId = Symbol.for('@systemfsoftware/stryker-js/ProjectSelectionDecision')
type ProjectSelectionTypeId = typeof ProjectSelectionTypeId

const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

const { max: maxOf, min: minOf } = Math
const mutationRangeSpecifierSchema = MutationRangeSpecifierSchema

const IGNORE_PATTERN_CHARACTER = '!'

type FileMutate = boolean | readonly Mutant.Location[]

type FileDescriptionLike = { readonly mutate: FileMutate }

interface FileSelectionInput {
  readonly inputFileNames: readonly string[]
  readonly mutatePatterns: readonly string[]
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly testFilePatterns: readonly string[]
  readonly testFileIgnores: readonly string[] | undefined
  readonly basePath: string
}

interface SelectedFiles {
  readonly fileDescriptions: Record<string, { readonly mutate: boolean | readonly Mutant.Location[] }>
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
    Match.withReturnType<GlobStep>(),
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
  return Boolean.match(trimmed.length === 0, { onTrue: () => '', onFalse: () => trimmed })
}

const resolveAgainstBase = (basePath: string, pattern: string) => {
  const normalized = normalizeFileName(pattern)
  const base = trimTrailingSlashes(normalizeFileName(basePath))
  return Boolean.match(normalized.startsWith('/'), {
    onTrue: () => normalized,
    onFalse: () =>
      `${base}/${
        Boolean.match(normalized.startsWith('./'), {
          onTrue: () => normalized.slice(2),
          onFalse: () => normalized,
        })
      }`,
  })
}

const globPatternOf = (pattern: boolean | string) =>
  Match.value(pattern).pipe(
    Match.withReturnType<string | undefined>(),
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

const isExcludedHiddenFile = (
  normalizedFile: string,
  base: string,
  allowHiddenFiles: boolean,
  patternHasDot: boolean,
) =>
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
    Match.withReturnType<(fileName: string) => boolean>(),
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
  Option.filter(Option.fromUndefinedOr(mutate), (value): value is readonly Mutant.Location[] => Array.isArray(value))

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

const overlapOf = (firstRange: Mutant.Location, secondRange: Mutant.Location) => {
  const startLine = maxOf(firstRange.start.line, secondRange.start.line)
  const endLine = minOf(firstRange.end.line, secondRange.end.line)
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

const isLocation = (value: Mutant.Location | undefined): value is Mutant.Location => value !== undefined

const overlapRanges = (firstRanges: readonly Mutant.Location[], secondRanges: readonly Mutant.Location[]) =>
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

const columnOf = (column: number | undefined, fallback: number) =>
  Option.getOrElse(Option.fromUndefinedOr(column), () => fallback)

const spanOf = (specifier: MutationRangeSpecifier) => ({
  start: { line: specifier.startLine, column: columnOf(specifier.startColumn, 1) },
  end: { line: specifier.endLine, column: columnOf(specifier.endColumn, Number.MAX_SAFE_INTEGER) },
})

const mutationRangeOf = (mutatePattern: string) =>
  Option.map(S.decodeOption(mutationRangeSpecifierSchema)(mutatePattern), (specifier) => ({
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
      return HashMap.reduce(
        matched,
        selected,
        (inner, description, fileName) =>
          Option.match(HashMap.get(inner, fileName), {
            onNone: () => HashMap.set(inner, fileName, unionDescription(description, undefined)),
            onSome: (existing) => HashMap.set(inner, fileName, unionDescription(description, existing)),
          }),
      )
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
  return HashMap.reduce(
    matched,
    seen,
    (innerSeen, description, fileName) =>
      Option.match(HashMap.get(afterMutate, fileName), {
        onNone: () => innerSeen,
        onSome: (current) => {
          const intersected = intersectFileDescriptions(current, description)
          const alreadySeen = Option.getOrElse(HashMap.get(innerSeen, fileName), () => undefined)
          return HashMap.set(innerSeen, fileName, unionDescription(intersected, alreadySeen))
        },
      }),
  )
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
  return HashMap.reduce(
    afterMutate,
    HashMap.empty<string, FileDescriptionLike>(),
    (acc, _description, fileName) =>
      Option.match(HashMap.get(seen, fileName), {
        onNone: () => HashMap.set(acc, fileName, { mutate: false as const }),
        onSome: (seenValue) => HashMap.set(acc, fileName, seenValue),
      }),
  )
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

const resolveTestFilesPure = (
  inputFileNames: readonly string[],
  testFilePatterns: readonly string[],
  basePath: string,
  testFileIgnores: readonly string[],
) =>
  Boolean.match(testFilePatterns.length === 0, {
    onTrue: (): readonly string[] => [],
    onFalse: () => {
      const ignoredBy = testFileIgnores.map((pattern) => createPureMatcher(pattern, false, basePath))
      return Array.from(
        HashSet.fromIterable(
          testFilePatterns.flatMap((pattern) => {
            const matches = createPureMatcher(pattern, false, basePath)
            return Array.from(inputFileNames).filter(
              (fileName) => Boolean.every([matches(fileName), !ignoredBy.some((ignores) => ignores(fileName))]),
            )
          }),
        ),
      )
    },
  })

const selectFiles = (input: FileSelectionInput): SelectedFiles => ({
  fileDescriptions: resolveFileDescriptionsPure(
    input.inputFileNames,
    input.mutatePatterns,
    input.targetMutatePatterns,
    input.basePath,
  ),
  testFiles: resolveTestFilesPure(
    input.inputFileNames,
    input.testFilePatterns,
    input.basePath,
    Option.getOrElse(Option.fromUndefinedOr(input.testFileIgnores), () => []),
  ),
})

const MutateDescriptionSchema = S.Union([S.Boolean, S.Array(Mutant.Location)])

const FileDescriptionsSchema = S.Record(S.String, S.Struct({ mutate: MutateDescriptionSchema }))

export class ProjectSelectionCommand extends S.TaggedClass<ProjectSelectionCommand>()('ProjectSelectionCommand', {
  inputFileNames: S.Array(S.String),
  mutatePatterns: S.Array(S.String),
  targetMutatePatterns: S.Array(S.String).pipe(S.optional),
  testFilePatterns: S.Array(S.String),
  testFileIgnores: S.Array(S.String).pipe(S.optional),
  basePath: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    basePath: 'stryker.project_selection.base_path',
  } as const
}

export class ProjectFilesDiscovered extends S.TaggedClass<ProjectFilesDiscovered>()('ProjectFilesDiscovered', {
  fileDescriptions: FileDescriptionsSchema,
  testFiles: S.Array(S.String),
}) {
  readonly [ProjectSelectionTypeId] = ProjectSelectionTypeId
}

export class ProjectFilesNoneDiscovered extends S.TaggedClass<ProjectFilesNoneDiscovered>()(
  'ProjectFilesNoneDiscovered',
  {},
) {
  readonly [ProjectSelectionTypeId] = ProjectSelectionTypeId
}

export const ProjectSelectionDecision = S.Union([ProjectFilesDiscovered, ProjectFilesNoneDiscovered])
export type ProjectSelectionDecision = typeof ProjectSelectionDecision.Type

export const selectProjectFiles = Workflow.make({
  command: ProjectSelectionCommand,
  decision: ProjectSelectionDecision,
  error: S.Never,
  decide: (command): Result.Result<ProjectSelectionDecision, never> =>
    Result.succeed(
      Boolean.match(command.inputFileNames.length === 0, {
        onTrue: () => ProjectFilesNoneDiscovered.make({}),
        onFalse: () =>
          ProjectFilesDiscovered.make(
            selectFiles({
              inputFileNames: command.inputFileNames,
              mutatePatterns: command.mutatePatterns,
              targetMutatePatterns: command.targetMutatePatterns,
              testFilePatterns: command.testFilePatterns,
              testFileIgnores: command.testFileIgnores,
              basePath: command.basePath,
            }),
          ),
      }),
    ),
})
