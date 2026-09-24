import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { FrameworkManifestSchema, ProjectDependencies } from './Plugins.schema.js'
import type { FrameworkClaimant } from './run/explain-file-skip.workflow.js'

const dependencyNamesOf = (
  dependencies: S.Schema.Type<typeof ProjectDependencies>['dependencies'],
): readonly string[] => Object.keys(dependencies ?? {})

const installedClaimantOf =
  (fs: FileSystem.FileSystem, path: Path.Path, basePath: string) =>
  (name: string): Effect.Effect<Option.Option<FrameworkClaimant>, never> =>
    Effect.gen(function*() {
      const text = yield* fs
        .readFileString(path.join(basePath, 'node_modules', name, 'package.json'))
        .pipe(Effect.orElseSucceed(() => ''))
      return Option.map(
        Option.filter(
          Result.match(S.decodeResult(S.fromJsonString(FrameworkManifestSchema))(text), {
            onFailure: () => Option.none<readonly string[]>(),
            onSuccess: (manifest) => Option.some([...manifest.strykerFramework.extensions]),
          }),
          (extensions) => extensions.length > 0,
        ),
        (extensions): FrameworkClaimant => ({ package: name, extensions }),
      )
    })

export const installedFrameworkClaimants = (
  basePath: string,
): Effect.Effect<readonly FrameworkClaimant[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(basePath, 'package.json')).pipe(Effect.orElseSucceed(() => ''))
    const names = yield* Result.match(S.decodeResult(S.fromJsonString(ProjectDependencies))(text), {
      onFailure: () => Effect.succeed<readonly string[]>([]),
      onSuccess: (manifest) =>
        Effect.succeed(
          Array.dedupe([
            ...dependencyNamesOf(manifest.dependencies),
            ...dependencyNamesOf(manifest.devDependencies),
          ]),
        ),
    })
    const found = yield* Effect.forEach(names, installedClaimantOf(fs, path, basePath), {
      concurrency: 'unbounded',
    })
    return Array.getSomes(found)
  })
