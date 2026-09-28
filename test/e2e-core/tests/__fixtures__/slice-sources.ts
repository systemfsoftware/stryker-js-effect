import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { PlacementFixtureUnreadable, PlacementSliceUndecodable } from './placement-failure.schema.js'
import { PlacementSlice, type PlacementSliceEncoded } from './placement-slice.schema.js'
import { placementSlices } from './placement-slices.js'
import { renderedFailureOf } from './rendered-failure.js'
import { loadedSliceMutatorsOf, type SliceMutators } from './slice-mutators.js'

export interface SliceSource {
  readonly name: string
  readonly absolutePath: string
  readonly content: string
}

export interface SliceFixture {
  readonly slice: PlacementSlice
  readonly files: ReadonlyArray<SliceSource>
  readonly mutators: SliceMutators
  readonly checkerTsconfigFile: string
}

const DEFAULT_CHECKER_TSCONFIG_FILE = 'tsconfig.json'

const ConfiguredChecker = S.Struct({
  tsconfigFile: S.optional(S.NonEmptyString),
})

const checkerTsconfigFileOf = (input: {
  readonly slice: PlacementSlice
  readonly fixtureDirectory: string
  readonly fixtureDirectoryUrl: URL
}): Effect.Effect<string, PlacementFixtureUnreadable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fallback = path.join(input.fixtureDirectory, DEFAULT_CHECKER_TSCONFIG_FILE)
    const configPath = path.join(input.fixtureDirectory, input.slice.id)
    const configured = yield* Effect.mapError(fs.exists(configPath), (cause) =>
      PlacementFixtureUnreadable.make({
        reason: `the slice config "${input.slice.id}" could not be inspected: ${renderedFailureOf(cause)}`,
      }))
    if (!configured) {
      return fallback
    }
    const loaded = yield* Effect.tryPromise({
      try: () => import(new URL(input.slice.id, input.fixtureDirectoryUrl).href),
      catch: (cause) =>
        PlacementFixtureUnreadable.make({
          reason: `the slice config "${input.slice.id}" could not be loaded: ${renderedFailureOf(cause)}`,
        }),
    })
    const decoded = yield* Effect.mapError(
      S.decodeUnknownEffect(ConfiguredChecker)(loaded.default),
      (issue) =>
        PlacementFixtureUnreadable.make({
          reason: `the slice config "${input.slice.id}" carries no usable tsconfigFile: ${issue.message}`,
        }),
    )
    return path.resolve(input.fixtureDirectory, decoded.tsconfigFile ?? DEFAULT_CHECKER_TSCONFIG_FILE)
  })

const repositoryRoot: Effect.Effect<string, PlacementFixtureUnreadable, Path.Path> = Effect.gen(function*() {
  const path = yield* Path.Path
  const here = yield* Effect.mapError(
    path.fromFileUrl(new URL(import.meta.url)),
    (cause) =>
      PlacementFixtureUnreadable.make({
        reason: `the fixtures module URL has no file path: ${renderedFailureOf(cause)}`,
      }),
  )
  return path.resolve(path.dirname(here), '..', '..', '..', '..')
})

const undecodable = (slice: PlacementSliceEncoded, reason: string): PlacementSliceUndecodable =>
  PlacementSliceUndecodable.make({ reason: `the placement slice "${slice.id}" does not decode: ${reason}` })

const sourcesOf = (
  slice: PlacementSlice,
  fixtureDirectory: string,
): Effect.Effect<ReadonlyArray<SliceSource>, PlacementFixtureUnreadable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const excludes = slice.mutateFiles.filter((pattern) => pattern.startsWith('!')).map((p) => p.slice(1))
    const matchers = slice.mutateFiles.filter((pattern) => !pattern.startsWith('!'))
    const matched = (yield* Effect.forEach(matchers, (pattern) =>
      Effect.mapError(
        fs.glob(pattern, { root: fixtureDirectory, exclude: excludes }),
        (cause) =>
          PlacementFixtureUnreadable.make({
            reason: `the slice "${slice.id}" could not expand "${pattern}": ${renderedFailureOf(cause)}`,
          }),
      ))).flat()
    const absolute = Array.dedupe(
      matched.map((match) => (path.isAbsolute(match) ? match : path.join(fixtureDirectory, match))),
    ).sort((left, right) => left.localeCompare(right))
    return yield* Effect.forEach(absolute, (absolutePath) =>
      Effect.map(
        Effect.mapError(
          fs.readFileString(absolutePath),
          (cause) =>
            PlacementFixtureUnreadable.make({
              reason: `the slice "${slice.id}" could not read "${absolutePath}": ${renderedFailureOf(cause)}`,
            }),
        ),
        (content): SliceSource => ({
          name: path.relative(fixtureDirectory, absolutePath).split(path.sep).join('/'),
          absolutePath,
          content,
        }),
      ))
  })

const fixtureOf = (
  encoded: PlacementSliceEncoded,
  root: string,
): Effect.Effect<
  SliceFixture,
  PlacementFixtureUnreadable | PlacementSliceUndecodable,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const slice = yield* Effect.mapError(
      S.decodeEffect(PlacementSlice)(encoded),
      (issue) => undecodable(encoded, issue.message),
    )
    const fixtureDirectory = path.resolve(root, slice.fixtureDir)
    const directoryUrl = yield* Effect.mapError(
      path.toFileUrl(fixtureDirectory),
      (cause) => undecodable(encoded, `"${fixtureDirectory}" is not a file URL: ${renderedFailureOf(cause)}`),
    )
    const fixtureDirectoryUrl = new URL(`${directoryUrl.href}/`)
    const [files, mutators, checkerTsconfigFile] = yield* Effect.all([
      sourcesOf(slice, fixtureDirectory),
      loadedSliceMutatorsOf({ slice, fixtureDirectory: fixtureDirectoryUrl }),
      checkerTsconfigFileOf({ slice, fixtureDirectory, fixtureDirectoryUrl }),
    ])
    return { slice, files, mutators, checkerTsconfigFile }
  })

export const sliceFixtures: Effect.Effect<
  ReadonlyArray<SliceFixture>,
  PlacementFixtureUnreadable | PlacementSliceUndecodable,
  FileSystem.FileSystem | Path.Path
> = Effect.flatMap(repositoryRoot, (root) => Effect.forEach(placementSlices, (encoded) => fixtureOf(encoded, root)))
