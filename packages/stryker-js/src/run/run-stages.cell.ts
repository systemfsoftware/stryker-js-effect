import { Cell } from '@systemfsoftware/effect-cell-types'

import { concurrencyCell } from '../concurrency.cell.js'
import type { ConfigReadError } from '../ConfigError.schema.js'
import { readProjectCell } from '../read-project.cell.js'
import { refuseLocalMutationCell } from '../refuse-local-mutation.cell.js'
import { StageError } from '../Run.schema.js'
import { dryRunCell } from './dry-run.cell.js'
import { instrumentCell } from './instrument.cell.js'
import { loadConfigCell } from './load-config.cell.js'
import { mutationTestCell as mutationTestStageCell } from './mutation-test.cell.js'
import type { MutationTestDone } from './mutation-test.cell.js'
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
  Cell.andThen(
    Cell.andThen(concurrencyCell, instrumentCell),
    Cell.andThen(dryRunCell, mutationTestStageCell),
  ),
)

export const mutationTestCell: Cell.Cell<PrepareExecutorArgs, MutationTestDone, StageError, StageServices> =
  prepareStageCell
