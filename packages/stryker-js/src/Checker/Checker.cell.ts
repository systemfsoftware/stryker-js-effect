import { Cell } from '@systemfsoftware/effect-cell-types'

import { checkCell } from './check.cell.js'
import type { CheckerCellError, CheckerRequest } from './Checker.handle.js'
import type { CheckedPlansResult } from './Checker.schema.js'
import { groupCell } from './group.cell.js'

export const checkGroupedCell: Cell.Cell<CheckerRequest, CheckedPlansResult, CheckerCellError, never> = groupCell.pipe(
  Cell.flatMap((groups) =>
    Cell.mapInput(
      Cell.collect(checkCell, (perGroup) => perGroup.flat()),
      (input: CheckerRequest) => groups.map((group) => ({ ...input, plans: group })),
    )
  ),
)
