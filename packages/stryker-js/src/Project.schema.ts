import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import * as MutableHashMap from 'effect/MutableHashMap'

import type { IncrementalReport } from './IncrementalReport.schema.js'

export interface ProjectFile extends Instrument.FileDescription {
  readonly name: string
  readonly mutate: Instrument.MutateDescription
  readonly content: string | undefined
  readonly originalContent: string | undefined
}

export interface Project {
  readonly fileDescriptions: Instrument.FileDescriptions
  readonly incrementalReport: IncrementalReport | undefined
  readonly testFiles: readonly string[]
  readonly files: MutableHashMap.MutableHashMap<string, ProjectFile>
  readonly filesToMutate: MutableHashMap.MutableHashMap<string, ProjectFile>
}
