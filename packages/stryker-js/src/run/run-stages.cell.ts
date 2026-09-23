import { Cell } from '@systemfsoftware/effect-cell-types'

import { StageError } from '../Run.schema.js'
import { dryRunCell } from './dry-run.cell.js'
import { instrumentCell } from './instrument.cell.js'
import { mutationTestCell as mutationTestStageCell } from './mutation-test.cell.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import { prepareCell } from './prepare.cell.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'
import type { StageServices } from './StageServices.service.js'

export const mutationTestCell: Cell.Cell<PrepareExecutorArgs, MutationTestDone, StageError, StageServices> = Cell
  .andThen(
    Cell.andThen(Cell.andThen(prepareCell, instrumentCell), dryRunCell),
    mutationTestStageCell,
  )
