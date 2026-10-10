import type { BenchSide, SetupRecovery, SetupStep } from '@systemfsoftware/stryker-e2e-core'

export interface PreparedSide {
  readonly side: BenchSide
  readonly root: string
  readonly cwd: string
  readonly cli: string
  readonly configFile: string
  readonly setupSteps: ReadonlyArray<SetupStep>
  readonly recovered: SetupRecovery
}
