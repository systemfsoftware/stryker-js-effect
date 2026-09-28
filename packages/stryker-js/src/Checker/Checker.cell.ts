import { Cell } from '@systemfsoftware/effect-cell-types'

import { checkCell } from './check.cell.js'
import type { CheckedPlansResult, CheckerCellError, CheckerRequest } from './Checker.protocol.js'
import { groupCell } from './group.cell.js'

export const checkGroupedCell: Cell.Cell<CheckerRequest, CheckedPlansResult, CheckerCellError, never> = groupCell.pipe(
  Cell.flatMap((groups) =>
    Cell.mapInput(
      Cell.collect(checkCell, (perGroup) => perGroup.flat()),
      (input: CheckerRequest) => groups.map((group) => ({ ...input, plans: group })),
    )
  ),
)
