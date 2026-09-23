import { Cell } from '@systemfsoftware/effect-cell-types'

import { readProjectCell } from '../read-project.cell.js'
import { StageError } from '../Run.schema.js'
import { dryRunCell } from './dry-run.cell.js'
import { instrumentCell } from './instrument.cell.js'
import { loadConfigCell } from './load-config.cell.js'
import { mutationTestCell as mutationTestStageCell } from './mutation-test.cell.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import { prepareCell } from './prepare.cell.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'
import type { StageServices } from './StageServices.service.js'

const prepareStageCell = Cell.andThen(
  Cell.andThen(
    Cell.andThen(
      Cell.mapError(loadConfigCell, (cause) =>
        StageError.make({ stage: 'prepare', reason: 'Failed to read config', cause })),
      Cell.mapError(readProjectCell, (cause) =>
        StageError.make({ stage: 'prepare', reason: 'Failed to read project', cause })),
    ),
    prepareCell,
  ),
  Cell.andThen(Cell.andThen(instrumentCell, dryRunCell), mutationTestStageCell),
)

export const mutationTestCell: Cell.Cell<PrepareExecutorArgs, MutationTestDone, StageError, StageServices> =
  prepareStageCell
