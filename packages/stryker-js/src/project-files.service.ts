import { Boolean } from 'effect'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

import type { ProjectFile } from './Project.schema.js'

const CONCURRENCY = 24

type ContentPair = readonly [ProjectFile, string]

type PathPair = readonly [string, string]

type FilesWithTarget = {
  readonly files: Iterable<readonly [string, ProjectFile]>
  readonly directory: string
  readonly basePath: string
}

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

export class ProjectFiles extends Context.Service<ProjectFiles, ProjectFilesShape>()(
  '@systemfsoftware/stryker-js/ProjectFiles',
) {
  static readonly layer: Layer.Layer<ProjectFiles, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
    ProjectFiles,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path

      const currentContent = (file: ProjectFile) =>
        Option.orElse(Option.fromUndefinedOr(file.content), () => Option.fromUndefinedOr(file.originalContent))
      const readFromDisk = (file: ProjectFile) => fs.readFileString(file.name)
      const read = (file: ProjectFile) =>
        Option.match(currentContent(file), {
          onSome: Effect.succeed,
          onNone: () => readFromDisk(file),
        })
      const changed = (file: ProjectFile) => file.content !== undefined && file.content !== file.originalContent
      const overwriteInPlace = (file: ProjectFile) =>
        Option.match(Option.filter(Option.fromUndefinedOr(file.content), () => changed(file)), {
          onNone: () => Effect.void,
          onSome: (text) => fs.writeFileString(file.name, text),
        })
      const writeInto = (directory: string, file: ProjectFile, basePath: string) =>
        Effect.gen(function*() {
          const targetFileName = pathService.join(directory, pathService.relative(basePath, file.name))
          yield* fs.makeDirectory(pathService.dirname(targetFileName), { recursive: true })
          const content = yield* read(file)
          yield* fs.writeFileString(targetFileName, content)
          return targetFileName
        })
      const copyAll = ({ files, directory, basePath }: FilesWithTarget) =>
        Effect.forEach(
          files,
          ([name, file]) =>
            Effect.map(
              writeInto(directory, file, basePath),
              (targetFileName): PathPair => [name, targetFileName],
            ),
          { concurrency: CONCURRENCY },
        )

      return ProjectFiles.of({
        read,
        readAll: (files) =>
          Effect.forEach(files, (file) => Effect.map(read(file), (content): ContentPair => [file, content]), {
            concurrency: CONCURRENCY,
          }),
        readAllOriginal: (files) =>
          Effect.forEach(
            files,
            (file) => Effect.map(readFromDisk(file), (content): ContentPair => [file, content]),
            { concurrency: CONCURRENCY },
          ),
        writeAllInPlace: (files, target) =>
          Effect.forEach(
            files,
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
        writeAllToSandbox: (files, target) =>
          copyAll({ files, directory: target.workingDirectory, basePath: target.basePath }),
      })
    }),
  )
}
