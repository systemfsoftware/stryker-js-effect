import { Handle } from '@systemfsoftware/effect-cell-types'
import { lineStartsOf, offsetAt } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import type { FileSystem as TSFileSystem, FileSystemEntries } from 'typescript/unstable/fs'

import { HybridFileNotFoundError, HybridMutantOutsideFileError } from './Compiler.schema.js'

export const TypeId = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TSFiles')
export type TypeId = typeof TypeId

const normalizeFileName = (fileName: string) => fileName.replace(/\\/g, '/')

const isBuildInfoFile = (fileName: string) => normalizeFileName(fileName).endsWith('.tsbuildinfo')

export interface ScriptFile {
  readonly fileName: string
  readonly originalContent: string
  readonly content: string
  readonly modifiedTime: DateTime.Utc
  readonly lineStarts: Mutant.LineStarts
}

interface TSFilesSources {
  readonly files: HashMap.HashMap<string, Option.Option<ScriptFile>>
  readonly overrides: HashMap.HashMap<string, string>
}

interface SynchronousSnapshot {
  current: TSFilesSources
}

interface TSFilesState {
  readonly host: FileSystem.FileSystem
  readonly snapshot: SynchronousSnapshot
}

const TSFiles = Handle.make<object, TSFilesState>()(TypeId)

export type TSFiles = Handle.Of<typeof TSFiles>

export const isTSFiles = TSFiles.is

const stateOf = (self: TSFiles): TSFilesState => TSFiles.slot(self)

const emptySources: TSFilesSources = { files: HashMap.empty(), overrides: HashMap.empty() }

export const make = (host: FileSystem.FileSystem): TSFiles =>
  TSFiles.make({}, {
    host,
    snapshot: { current: emptySources },
  })

const publish = (state: TSFilesState, next: (sources: TSFilesSources) => TSFilesSources): Effect.Effect<void> =>
  Effect.sync(() => {
    state.snapshot.current = next(state.snapshot.current)
  })

const makeScriptFile = (content: string, fileName: string, now: DateTime.Utc): ScriptFile => ({
  content,
  fileName,
  originalContent: content,
  modifiedTime: now,
  lineStarts: lineStartsOf(content),
})

const withContent = (file: ScriptFile, content: string, now: DateTime.Utc): ScriptFile => ({
  ...file,
  content,
  modifiedTime: now,
})

const mutateScriptFile = (
  file: ScriptFile,
  mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>,
  now: DateTime.Utc,
): Option.Option<ScriptFile> =>
  Option.map(
    Option.all([
      offsetAt(file.lineStarts, mutant.location.start),
      offsetAt(file.lineStarts, mutant.location.end),
    ]),
    ([start, end]) =>
      withContent(
        file,
        file.originalContent.slice(0, start) + mutant.replacement + file.originalContent.slice(end),
        now,
      ),
  )

const resetScriptFile = (file: ScriptFile, now: DateTime.Utc): ScriptFile => ({
  ...file,
  content: file.originalContent,
  modifiedTime: now,
})

const now: Effect.Effect<DateTime.Utc> = Effect.map(Clock.currentTimeMillis, DateTime.makeUnsafe)

const readFromDisk = Effect.fnUntraced(function*(state: TSFilesState, fileName: string) {
  const at = yield* now
  const file = Option.map(
    yield* Effect.option(state.host.readFileString(fileName)),
    (content) => makeScriptFile(content, fileName, at),
  )
  yield* publish(state, (sources) => ({ ...sources, files: HashMap.set(sources.files, fileName, file) }))
  return file
})

export const getFile: {
  (fileName: string): (self: TSFiles) => Effect.Effect<Option.Option<ScriptFile>>
  (self: TSFiles, fileName: string): Effect.Effect<Option.Option<ScriptFile>>
} = dual(
  2,
  (self: TSFiles, fileName: string): Effect.Effect<Option.Option<ScriptFile>> => {
    const state = stateOf(self)
    const normalized = normalizeFileName(fileName)
    return Option.match(HashMap.get(state.snapshot.current.files, normalized), {
      onNone: () => readFromDisk(state, normalized),
      onSome: Effect.succeed,
    })
  },
)

export const mutateFile: {
  (
    fileName: string,
    mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>,
  ): (self: TSFiles) => Effect.Effect<void, HybridFileNotFoundError | HybridMutantOutsideFileError>
  (
    self: TSFiles,
    fileName: string,
    mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>,
  ): Effect.Effect<void, HybridFileNotFoundError | HybridMutantOutsideFileError>
} = dual(
  3,
  Effect.fnUntraced(function*(
    self: TSFiles,
    fileName: string,
    mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>,
  ): Effect.fn.Return<void, HybridFileNotFoundError | HybridMutantOutsideFileError> {
    const state = stateOf(self)
    const at = yield* now
    const file = yield* getFile(self, fileName)
    yield* Option.match(file, {
      onNone: () => Effect.fail(HybridFileNotFoundError.make({ fileName })),
      onSome: (found) =>
        Option.match(mutateScriptFile(found, mutant, at), {
          onNone: () => Effect.fail(HybridMutantOutsideFileError.make({ fileName })),
          onSome: (mutated) =>
            publish(state, (sources) => ({
              ...sources,
              files: HashMap.set(sources.files, normalizeFileName(fileName), Option.some(mutated)),
            })),
        }),
    })
  }),
)

export const resetFile: {
  (fileName: string): (self: TSFiles) => Effect.Effect<void>
  (self: TSFiles, fileName: string): Effect.Effect<void>
} = dual(
  2,
  Effect.fnUntraced(function*(self: TSFiles, fileName: string) {
    const state = stateOf(self)
    const at = yield* now
    const normalized = normalizeFileName(fileName)
    yield* Option.match(HashMap.get(state.snapshot.current.files, normalized), {
      onNone: () => Effect.void,
      onSome: Option.match({
        onNone: () => Effect.void,
        onSome: (file) =>
          publish(state, (sources) => ({
            ...sources,
            files: HashMap.set(sources.files, normalized, Option.some(resetScriptFile(file, at))),
          })),
      }),
    })
  }),
)

export const setOverrides: {
  (overrides: HashMap.HashMap<string, string>): (self: TSFiles) => Effect.Effect<void>
  (self: TSFiles, overrides: HashMap.HashMap<string, string>): Effect.Effect<void>
} = dual(
  2,
  (self: TSFiles, overrides: HashMap.HashMap<string, string>): Effect.Effect<void> =>
    publish(stateOf(self), (sources) => ({ ...sources, overrides })),
)

export const tsFileSystem = (self: TSFiles): TSFileSystem => {
  const state = stateOf(self)
  const contentFromSources = (fileName: string): string | null | undefined =>
    Option.match(HashMap.get(state.snapshot.current.overrides, fileName), {
      onSome: (override) => override,
      onNone: () =>
        Option.match(HashMap.get(state.snapshot.current.files, fileName), {
          onNone: () => undefined,
          onSome: Option.match({ onNone: () => null, onSome: (file) => file.content }),
        }),
    })

  const existsInSources = (fileName: string): boolean | undefined =>
    Option.match(HashMap.get(state.snapshot.current.overrides, fileName), {
      onSome: () => true,
      onNone: () =>
        Option.match(HashMap.get(state.snapshot.current.files, fileName), {
          onNone: () => undefined,
          onSome: Option.isSome,
        }),
    })

  return {
    readFile: (fileName) =>
      Boolean.match(isBuildInfoFile(fileName), {
        onTrue: () => null,
        onFalse: () => contentFromSources(normalizeFileName(fileName)),
      }),
    fileExists: (fileName) =>
      Boolean.match(isBuildInfoFile(fileName), {
        onTrue: () => false,
        onFalse: () => existsInSources(normalizeFileName(fileName)),
      }),
    directoryExists: () => undefined,
    getAccessibleEntries: (): FileSystemEntries | undefined => undefined,
    realpath: () => undefined,
  }
}
