import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type { PlatformError } from 'effect/PlatformError'

import type { ProjectFile } from './Project.schema.js'

export type ContentPair = readonly [ProjectFile, string]

export type PathPair = readonly [string, string]

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
  '@systemfsoftware/stryker-js/project-files.service/ProjectFiles',
) {}
