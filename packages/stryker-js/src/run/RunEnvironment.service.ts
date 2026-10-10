import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'

import type { ConfigOverlay } from '../config/stryker-config.schema.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import { RunEvents } from '../run-events.service.js'
import { PhaseClock } from './phase-clock.service.js'

export interface RunEnvironmentShape {
  readonly runId: string
  readonly resolvedMode: ResolvedMode
  readonly runStartedAt: number
  readonly basePath: string
  readonly builtinReporters: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
  readonly configOverlay: ConfigOverlay
  readonly allowConsoleColors: boolean
}

export class RunEnvironment extends Context.Service<RunEnvironment, RunEnvironmentShape>()(
  '@systemfsoftware/stryker-js/run/RunEnvironment.service/RunEnvironment',
) {}

export const phaseEntered = Effect.fn(SpanTaxonomy.Spans.phaseEntered.name)(
  function*(phase: RunEvent.PhaseEntered['phase']) {
    const env = yield* RunEnvironment
    const now = yield* Clock.currentTimeMillis
    const queue = yield* RunEvents
    const clock = yield* PhaseClock
    const elapsedMs = now - env.runStartedAt
    yield* clock.markAt(phase, elapsedMs)
    yield* Queue.offer(queue, RunEvent.PhaseEntered.make({ phase, elapsedMs }))
  },
)
