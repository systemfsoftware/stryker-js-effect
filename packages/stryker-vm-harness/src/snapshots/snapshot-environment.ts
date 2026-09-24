import { FileSystem, Path } from 'effect'
import * as Effect from 'effect/Effect'
import { fileURLToPath } from 'node:url'

import { defaultSnapshotPath, SNAPSHOT_SUFFIX } from '../snapshot-paths.js'
import type { SnapshotEnvironmentLike } from './snapshot-api.js'

export interface SnapshotEnvironmentOptions {
  readonly fileSystem: FileSystem.FileSystem
  readonly path: Path.Path
  readonly snapshotPathFor?: ((testFile: string) => string) | undefined
}

const rawFileOfStack = (file: string): string => {
  const withoutQuery = file.replace(/[?#][\s\S]*$/, '')
  return withoutQuery.startsWith('file://') ? fileURLToPath(withoutQuery) : withoutQuery
}

export const createSnapshotEnvironment = (options: SnapshotEnvironmentOptions): SnapshotEnvironmentLike => {
  const contents = new Map<string, string | null>()
  const fileSystem = options.fileSystem
  const path = options.path

  const snapshotPathFor = (testFile: string): string =>
    options.snapshotPathFor === undefined ? defaultSnapshotPath(path, testFile) : options.snapshotPathFor(testFile)

  const readSnapshotFile = (filepath: string): Promise<string | null> => {
    if (filepath.endsWith(SNAPSHOT_SUFFIX) && contents.has(filepath)) {
      return Promise.resolve(contents.get(filepath) ?? null)
    }
    return Effect.runPromise(
      Effect.flatMap(
        fileSystem.exists(filepath),
        (exists) => exists ? fileSystem.readFileString(filepath) : Effect.succeed(null),
      ).pipe(
        Effect.map((content) => {
          if (filepath.endsWith(SNAPSHOT_SUFFIX)) {
            contents.set(filepath, content)
          }
          return content
        }),
      ),
    )
  }

  const saveSnapshotFile = (filepath: string, snapshot: string): Promise<void> =>
    Effect.runPromise(
      Effect.flatMap(
        fileSystem.makeDirectory(path.dirname(filepath), { recursive: true }),
        () => fileSystem.writeFileString(filepath, snapshot),
      ).pipe(
        Effect.map(() => {
          if (filepath.endsWith(SNAPSHOT_SUFFIX)) {
            contents.set(filepath, snapshot)
          }
        }),
      ),
    )

  const removeSnapshotFile = (filepath: string): Promise<void> =>
    Effect.runPromise(
      Effect.flatMap(fileSystem.exists(filepath), (exists) => exists ? fileSystem.remove(filepath) : Effect.void).pipe(
        Effect.map(() => {
          contents.delete(filepath)
        }),
      ),
    )

  return {
    getVersion: () => '1',
    getHeader: () => '// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html',
    resolvePath: (filepath) => snapshotPathFor(filepath),
    resolveRawPath: (testPath, rawPath) =>
      path.isAbsolute(rawPath) ? rawPath : path.resolve(path.dirname(testPath), rawPath),
    readSnapshotFile,
    saveSnapshotFile,
    removeSnapshotFile,
    processStackTrace: (stack) => ({ ...stack, file: rawFileOfStack(stack.file) }),
  }
}
