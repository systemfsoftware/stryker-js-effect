import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type { PlatformError } from 'effect/PlatformError'

export type OutputChannel = 'stdout' | 'stderr'

export interface ReporterOutputShape {
  readonly write: (channel: OutputChannel, chunks: readonly string[]) => Effect.Effect<void, PlatformError>
}

export class ReporterOutput extends Context.Service<ReporterOutput, ReporterOutputShape>()(
  '@systemfsoftware/stryker-js/reporter-output.service/ReporterOutput',
) {}
