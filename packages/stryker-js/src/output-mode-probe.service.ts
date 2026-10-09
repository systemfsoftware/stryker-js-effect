import type * as CliError from 'effect/cli/CliError'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

import type { ResolvedMode } from './output-mode.schema.js'

export interface OutputModeProbe {
  readonly detectMode: Effect.Effect<ResolvedMode, CliError.CliError>
}

class OutputModeProbeTag extends Context.Service<
  OutputModeProbeTag,
  OutputModeProbe
>()('@systemfsoftware/stryker-js/output-mode-probe.service/OutputModeProbeTag') {}

const OutputModeProbe = OutputModeProbeTag

export { OutputModeProbe }
