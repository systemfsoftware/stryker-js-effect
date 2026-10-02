import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'

import { concurrencyCell } from '../concurrency.cell.js'
import type { ConfigReadError } from '../ConfigError.schema.js'
import { readProjectCell } from '../read-project.cell.js'
import { RunFailure } from '../Run.schema.js'
import { dryRunCell } from './dry-run.cell.js'
import { instrumentCell } from './instrument.cell.js'
import { loadConfigCell } from './load-config.cell.js'
import { mutationTestCell as mutationTestStageCell } from './mutation-test.cell.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import { prepareCell } from './prepare.cell.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'
import type { StageServices } from './StageServices.service.js'

const configReadReasonOf = (cause: ConfigReadError): string =>
  Match.value(cause).pipe(
    Match.tag('ConfigError', (refused) => refused.message),
    Match.orElse(() => 'Failed to read config'),
  )

const prepareStageCell = Cell.andThen(
  Cell.andThen(
    Cell.andThen(
      Cell.mapError(
        loadConfigCell,
        (cause) => {
          const detail = configReadReasonOf(cause)
          return RunFailure.make({
            evidence: { _tag: 'ConfigInvalid', stage: 'config', detail },
            detail,
            cause,
          })
        },
      ),
      Cell.mapError(
        readProjectCell,
        (cause) =>
          RunFailure.make({
            evidence: { _tag: 'SandboxPreparationFailed', stage: 'prepare' },
            detail: 'Failed to read project',
            cause,
          }),
      ),
    ),
    prepareCell,
  ),
  Cell.andThen(
    Cell.andThen(concurrencyCell, instrumentCell),
    Cell.andThen(dryRunCell, mutationTestStageCell),
  ),
)

export const mutationTestCell: Cell.Cell<PrepareExecutorArgs, MutationTestDone, RunFailure, StageServices> =
  prepareStageCell
