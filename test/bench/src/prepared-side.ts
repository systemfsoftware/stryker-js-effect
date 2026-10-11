import type { BenchSide, SetupStep, WithheldPins } from '@systemfsoftware/stryker-e2e-core'
import type * as Option from 'effect/Option'

export interface PreparedSide {
  readonly side: BenchSide
  readonly root: string
  readonly tree: string
  readonly cwd: string
  readonly cli: string
  readonly configFile: string
  readonly setupSteps: ReadonlyArray<SetupStep>
  readonly withheldPins: Option.Option<WithheldPins>
}
