import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as MutableHashMap from 'effect/MutableHashMap'

export interface ProjectFile extends Instrument.FileDescription {
  readonly name: string
  readonly mutate: Instrument.MutateDescription
  readonly content: string | undefined
  readonly originalContent: string | undefined
}

export interface Project {
  readonly fileDescriptions: Instrument.FileDescriptions
  readonly incrementalReport: Report.MutationTestResult | undefined
  readonly testFiles: readonly string[]
  readonly files: MutableHashMap.MutableHashMap<string, ProjectFile>
  readonly filesToMutate: MutableHashMap.MutableHashMap<string, ProjectFile>
}
