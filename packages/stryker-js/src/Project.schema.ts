import type { FileDescription, FileDescriptions, MutateDescription } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutationTestResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as MutableHashMap from 'effect/MutableHashMap'

export interface ProjectFile extends FileDescription {
  readonly name: string
  readonly mutate: MutateDescription
  readonly content: string | undefined
  readonly originalContent: string | undefined
}

export interface Project {
  readonly fileDescriptions: FileDescriptions
  readonly incrementalReport: MutationTestResult | undefined
  readonly testFiles: readonly string[]
  readonly files: MutableHashMap.MutableHashMap<string, ProjectFile>
  readonly filesToMutate: MutableHashMap.MutableHashMap<string, ProjectFile>
}
