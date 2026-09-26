import { Boolean } from 'effect'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Stream from 'effect/Stream'

import type { ProjectFile } from './Project.schema.js'

const CONCURRENCY = 24

type ContentPair = readonly [ProjectFile, string]

type PathPair = readonly [string, string]

export interface InPlaceTarget {
  readonly backupDirectory: string
  readonly basePath: string
}

export interface SandboxTarget {
  readonly workingDirectory: string
  readonly basePath: string
}

export interface ProjectFilesShape {
  readonly read: (file: ProjectFile) => Effect.Effect<string, PlatformError>
  readonly readAll: (files: Iterable<ProjectFile>) => Effect.Effect<readonly ContentPair[], PlatformError>
  readonly readAllOriginal: (files: Iterable<ProjectFile>) => Effect.Effect<readonly ContentPair[], PlatformError>
  readonly writeAllInPlace: (
    files: Iterable<readonly [string, ProjectFile]>,
    target: InPlaceTarget,
  ) => Effect.Effect<readonly PathPair[], PlatformError>
  readonly writeAllToSandbox: (
    files: Iterable<readonly [string, ProjectFile]>,
    target: SandboxTarget,
  ) => Effect.Effect<readonly PathPair[], PlatformError>
}

const collect = <A, E, R>(stream: Stream.Stream<A, E, R>): Effect.Effect<readonly A[], E, R> =>
  Stream.runCollect(stream).pipe(Effect.map((chunk) => [...chunk]))

export class ProjectFiles extends Context.Service<ProjectFiles, ProjectFilesShape>()(
  '@systemfsoftware/stryker-js/project-files.service/ProjectFiles',
) {
  static readonly layer: Layer.Layer<ProjectFiles, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
    ProjectFiles,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path

      const currentContent = (file: ProjectFile) =>
        Option.orElse(Option.fromUndefinedOr(file.content), () => Option.fromUndefinedOr(file.originalContent))
      const readFromDisk = (file: ProjectFile) => fs.readFileString(file.name)
      const read = Effect.fn('stryker.project_files.read')(function*(file: ProjectFile) {
        const current = currentContent(file)
        return yield* Option.match(current, {
          onSome: (content) => Effect.succeed(content),
          onNone: () => readFromDisk(file),
        })
      })
      const changed = (file: ProjectFile) => file.content !== undefined && file.content !== file.originalContent
      const overwriteInPlace = (file: ProjectFile) =>
        Option.match(Option.filter(Option.fromUndefinedOr(file.content), () => changed(file)), {
          onNone: () => Effect.void,
          onSome: (text) => fs.writeFileString(file.name, text),
        })
      const writeInto = Effect.fn('stryker.project_files.write-into')(function*(
        directory: string,
        file: ProjectFile,
        basePath: string,
      ) {
        const targetFileName = pathService.join(directory, pathService.relative(basePath, file.name))
        yield* fs.makeDirectory(pathService.dirname(targetFileName), { recursive: true })
        const content = yield* read(file)
        yield* fs.writeFileString(targetFileName, content)
        return targetFileName
      })

      return ProjectFiles.of({
        read,
        readAll: (files) =>
          collect(
            Stream.fromIterable(files).pipe(
              Stream.mapEffect(
                (file) => Effect.map(read(file), (content): ContentPair => [file, content]),
                { concurrency: CONCURRENCY },
              ),
            ),
          ),
        readAllOriginal: (files) =>
          collect(
            Stream.fromIterable(files).pipe(
              Stream.mapEffect(
                (file) => Effect.map(readFromDisk(file), (content): ContentPair => [file, content]),
                { concurrency: CONCURRENCY },
              ),
            ),
          ),
        writeAllInPlace: (files, target) =>
          collect(
            Stream.fromIterable(files).pipe(
              Stream.mapEffect(
                ([name, file]) =>
                  Boolean.match(changed(file), {
                    onFalse: () => Effect.succeed<PathPair>([name, name]),
                    onTrue: () =>
                      writeInto(target.backupDirectory, file, target.basePath).pipe(
                        Effect.tap(() => Effect.logDebug('Stored backup file')),
                        Effect.andThen(overwriteInPlace(file)),
                        Effect.map((): PathPair => [name, name]),
                      ),
                  }),
                { concurrency: CONCURRENCY },
              ),
            ),
          ),
        writeAllToSandbox: (files, target) =>
          collect(
            Stream.fromIterable(files).pipe(
              Stream.mapEffect(
                ([name, file]) =>
                  Effect.map(
                    writeInto(target.workingDirectory, file, target.basePath),
                    (targetFileName): PathPair => [name, targetFileName],
                  ),
                { concurrency: CONCURRENCY },
              ),
            ),
          ),
      })
    }),
  )
}
