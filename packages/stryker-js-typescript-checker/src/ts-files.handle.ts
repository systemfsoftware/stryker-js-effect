import { Handle } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import type { FileSystem as TSFileSystem, FileSystemEntries } from 'typescript/unstable/fs'

import { HybridFileNotFoundError } from './Compiler.schema.js'

export const TypeId = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TSFiles')
export type TypeId = typeof TypeId

const normalizeFileName = (fileName: string) => fileName.replace(/\\/g, '/')

const isBuildInfoFile = (fileName: string) => normalizeFileName(fileName).endsWith('.tsbuildinfo')

export interface ScriptFile {
  readonly fileName: string
  readonly originalContent: string
  readonly content: string
  readonly modifiedTime: DateTime.Utc
}

interface TSFilesState {
  readonly host: FileSystem.FileSystem
  readonly files: Ref.Ref<MutableHashMap.MutableHashMap<string, Option.Option<ScriptFile>>>
  readonly overrides: Ref.Ref<MutableHashMap.MutableHashMap<string, string>>
}

const TSFiles = Handle.make<object, TSFilesState>()(TypeId)

export type TSFiles = Handle.Of<typeof TSFiles>

export const isTSFiles = TSFiles.is

const stateOf = (self: TSFiles): TSFilesState => TSFiles.slot(self)

export const make = (host: FileSystem.FileSystem): TSFiles =>
  TSFiles.make({}, {
    host,
    files: Ref.makeUnsafe(MutableHashMap.empty<string, Option.Option<ScriptFile>>()),
    overrides: Ref.makeUnsafe(MutableHashMap.empty<string, string>()),
  })

const makeScriptFile = (content: string, fileName: string, now: DateTime.Utc): ScriptFile => ({
  content,
  fileName,
  originalContent: content,
  modifiedTime: now,
})

const withContent = (file: ScriptFile, content: string, now: DateTime.Utc): ScriptFile => ({
  ...file,
  content,
  modifiedTime: now,
})

const offsetOf = (file: ScriptFile, pos: Mutant.Position) => {
  const lines = file.originalContent.split('\n')
  const lineCount = Math.min(pos.line - 1, lines.length)
  return lines.slice(0, lineCount).reduce((total, line) => total + line.length + 1, Math.max(0, pos.column - 1))
}

const mutateScriptFile = (
  file: ScriptFile,
  mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>,
  now: DateTime.Utc,
): ScriptFile => {
  const start = offsetOf(file, mutant.location.start)
  const end = offsetOf(file, mutant.location.end)
  return withContent(
    file,
    file.originalContent.slice(0, start) + mutant.replacement + file.originalContent.slice(end),
    now,
  )
}

const resetScriptFile = (file: ScriptFile, now: DateTime.Utc): ScriptFile => ({
  ...file,
  content: file.originalContent,
  modifiedTime: now,
})

const setInPlace = <K, V>(map: MutableHashMap.MutableHashMap<K, V>, key: K, value: V) => {
  MutableHashMap.set(map, key, value)
  return map
}

const now: Effect.Effect<DateTime.Utc> = Effect.map(Clock.currentTimeMillis, DateTime.makeUnsafe)

const readFromDisk = (state: TSFilesState, fileName: string): Effect.Effect<Option.Option<ScriptFile>> =>
  Effect.gen(function*() {
    const at = yield* now
    const file = Option.map(
      yield* Effect.option(state.host.readFileString(fileName)),
      (content) => makeScriptFile(content, fileName, at),
    )
    yield* Ref.update(state.files, (files) => setInPlace(files, fileName, file))
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
    return Option.match(MutableHashMap.get(Ref.getUnsafe(state.files), normalized), {
      onNone: () => readFromDisk(state, normalized),
      onSome: Effect.succeed,
    })
  },
)

export const mutateFile: {
  (
    fileName: string,
    mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>,
  ): (self: TSFiles) => Effect.Effect<void, HybridFileNotFoundError>
  (
    self: TSFiles,
    fileName: string,
    mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>,
  ): Effect.Effect<void, HybridFileNotFoundError>
} = dual(
  3,
  (
    self: TSFiles,
    fileName: string,
    mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>,
  ): Effect.Effect<void, HybridFileNotFoundError> =>
    Effect.gen(function*() {
      const state = stateOf(self)
      const at = yield* now
      const file = yield* getFile(self, fileName)
      yield* Option.match(file, {
        onNone: () => Effect.fail(HybridFileNotFoundError.make({ fileName })),
        onSome: (found) =>
          Ref.update(
            state.files,
            (files) => setInPlace(files, normalizeFileName(fileName), Option.some(mutateScriptFile(found, mutant, at))),
          ),
      })
    }),
)

export const resetFile: {
  (fileName: string): (self: TSFiles) => Effect.Effect<void>
  (self: TSFiles, fileName: string): Effect.Effect<void>
} = dual(
  2,
  (self: TSFiles, fileName: string): Effect.Effect<void> =>
    Effect.gen(function*() {
      const state = stateOf(self)
      const at = yield* now
      const normalized = normalizeFileName(fileName)
      yield* Option.match(MutableHashMap.get(Ref.getUnsafe(state.files), normalized), {
        onNone: () => Effect.void,
        onSome: Option.match({
          onNone: () => Effect.void,
          onSome: (file) =>
            Ref.update(state.files, (files) => setInPlace(files, normalized, Option.some(resetScriptFile(file, at)))),
        }),
      })
    }),
)

export const setOverrides: {
  (overrides: MutableHashMap.MutableHashMap<string, string>): (self: TSFiles) => Effect.Effect<void>
  (self: TSFiles, overrides: MutableHashMap.MutableHashMap<string, string>): Effect.Effect<void>
} = dual(
  2,
  (self: TSFiles, overrides: MutableHashMap.MutableHashMap<string, string>): Effect.Effect<void> =>
    Ref.set(stateOf(self).overrides, overrides),
)

export const tsFileSystem = (self: TSFiles): TSFileSystem => {
  const state = stateOf(self)
  const contentFromSources = (fileName: string): string | null | undefined =>
    Option.match(MutableHashMap.get(Ref.getUnsafe(state.overrides), fileName), {
      onSome: (override) => override,
      onNone: () =>
        Option.match(MutableHashMap.get(Ref.getUnsafe(state.files), fileName), {
          onNone: () => undefined,
          onSome: Option.match({ onNone: () => null, onSome: (file) => file.content }),
        }),
    })

  const existsInSources = (fileName: string): boolean | undefined =>
    Option.match(MutableHashMap.get(Ref.getUnsafe(state.overrides), fileName), {
      onSome: () => true,
      onNone: () =>
        Option.match(MutableHashMap.get(Ref.getUnsafe(state.files), fileName), {
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
