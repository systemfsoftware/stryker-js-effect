import type { BenchRepoEntry, BenchSide, SetupStep } from '@systemfsoftware/stryker-e2e-core'

export interface PreparedRepoEntry {
  readonly entry: BenchRepoEntry
  readonly cwd: string
  readonly configFile: string
}

export interface PreparedSide {
  readonly side: BenchSide
  readonly root: string
  readonly cli: string
  readonly repoEntries: ReadonlyArray<PreparedRepoEntry>
  readonly enterprise: {
    readonly cwd: string
    readonly cli: string
    readonly configFile: string
  }
  readonly setupSteps: ReadonlyArray<SetupStep>
}
