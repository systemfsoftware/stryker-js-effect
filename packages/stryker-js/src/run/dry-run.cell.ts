import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as EffectDuration from 'effect/Duration'
import * as Effect from 'effect/Effect'

import { dryRun, DryRunCommand, DryRunError } from '../dry-run.workflow.js'
import { StageError } from '../Run.schema.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { readDryRun, writeDryRunFailed, writeDryRunPassed } from './dry-run.parts.js'
import type { InstrumentDone } from './instrument.cell.js'

export interface DryRunDone extends InstrumentDone {
  readonly dryRunResult: TestRunner.CompleteDryRunResult
  readonly testCoverage: TestCoverage
  readonly timeOverhead: EffectDuration.Duration
}

export type DryRunRaw = typeof DryRunCommand.Encoded & {
  readonly prev: InstrumentDone
  readonly rawResult: TestRunner.DryRunResult
  readonly capabilities: TestRunner.TestRunnerCapabilities
  readonly gross: EffectDuration.Duration
}

export { isStageError } from './dry-run.parts.js'

export const dryRunCell = Sandwich.named('stryker.dry_run')(readDryRun).decide(dryRun).write({
  DryRunPassed: (_decision, raw) => writeDryRunPassed(raw),
  DryRunFailed: ({ testCount, failedTestCount, failedTests }, _raw) =>
    writeDryRunFailed({ testCount, failedTestCount, failedTests }),
  DryRunError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: DryRunError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'dryRun', reason: issue })),
})
