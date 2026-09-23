import type { ReporterFactory } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'

import type { ResolvedMode } from '../output-mode.js'

export interface RunEnvironmentShape {
  readonly runId: string
  readonly resolvedMode: ResolvedMode
  readonly runStartedAt: number
  readonly basePath: string
  readonly builtinReporters: Readonly<Record<string, ReporterFactory>>
  readonly allowConsoleColors: boolean
}

export class RunEnvironment extends Context.Service<RunEnvironment, RunEnvironmentShape>()(
  '@systemfsoftware/stryker-js/run/RunEnvironment',
) {}
