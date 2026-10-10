import { Cell } from '@systemfsoftware/effect-cell-types'

import { concurrencyCell } from '../concurrency.cell.js'
import type { ConfigReadError } from '../ConfigError.schema.js'
import type { MutationTestDone } from '../mutation-reporting.service.js'
import { readProjectCell } from '../read-project.cell.js'
import { refuseLocalMutationCell } from '../refuse-local-mutation.cell.js'
import { StageError } from '../Run.schema.js'
import { deferrableDryRunCell } from './deferrable-dry-run.cell.js'
import { instrumentCell } from './instrument.cell.js'
import { loadConfigCell } from './load-config.cell.js'
import { prepareCell } from './prepare.cell.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'
import type { StageServices } from './StageServices.service.js'

const configReadReasonOf = (cause: ConfigReadError): string => cause.message

const prepareStageCell = Cell.andThen(
  Cell.andThen(
    Cell.andThen(
      Cell.andThen(
        Cell.mapError(
          loadConfigCell,
          (cause) => StageError.make({ stage: 'prepare', reason: configReadReasonOf(cause), cause }),
        ),
        (loaded) => refuseLocalMutationCell(loaded),
      ),
      Cell.mapError(
        readProjectCell,
        (cause) => StageError.make({ stage: 'prepare', reason: 'Failed to read project', cause }),
      ),
    ),
    prepareCell,
  ),
  Cell.andThen(Cell.andThen(concurrencyCell, instrumentCell), deferrableDryRunCell),
)

export const mutationTestCell: Cell.Cell<PrepareExecutorArgs, MutationTestDone, StageError, StageServices> =
  prepareStageCell
