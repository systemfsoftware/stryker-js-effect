import { Cell } from '@systemfsoftware/effect-cell-types'

import type { Configuration } from '@systemfsoftware/stryker-js-contracts'
import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import { concurrencyCell } from '../concurrency.cell.js'
import { readProjectCell } from '../read-project.cell.js'
import { refuseLocalMutationCell } from '../refuse-local-mutation.cell.js'
import { deferrableDryRunCell } from './deferrable-dry-run.cell.js'
import { instrumentCell } from './instrument.cell.js'
import { loadConfigCell } from './load-config.cell.js'
import { prepareCell } from './prepare.cell.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'
import type { StageServices } from './StageServices.service.js'

const configReadReasonOf = (cause: Configuration.ConfigReadError): string => cause.message

const prepareStageCell = Cell.andThen(
  Cell.andThen(
    Cell.andThen(
      Cell.andThen(
        Cell.mapError(
          loadConfigCell,
          (cause) => Run.StageError.make({ stage: 'prepare', reason: configReadReasonOf(cause), cause }),
        ),
        (loaded) => refuseLocalMutationCell(loaded),
      ),
      Cell.mapError(
        readProjectCell,
        (cause) => Run.StageError.make({ stage: 'prepare', reason: 'Failed to read project', cause }),
      ),
    ),
    prepareCell,
  ),
  Cell.andThen(Cell.andThen(concurrencyCell, instrumentCell), deferrableDryRunCell),
)

export const mutationTestCell: Cell.Cell<PrepareExecutorArgs, Reports.MutationTestDone, Run.StageError, StageServices> =
  prepareStageCell
