import { Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import { badArgument } from 'effect/PlatformError'

import { admitIncrementalReport } from './admit-incremental-report.workflow.js'
import { discardLogOf, projectOf, readProjectCommand } from './read-project.parts.js'

export type { ReadProjectDone } from './read-project.parts.js'

export const readProjectCell = Sandwich.named('stryker.project_read')(readProjectCommand)
  .decide(admitIncrementalReport)
  .write({
    IncrementalReportKeep: (keep, command) => Effect.succeed(projectOf({ command, report: keep.report })),
    IncrementalReportDiscard: (discard, command) =>
      Effect.as(discardLogOf({ command, discard }), projectOf({ command, report: undefined })),
    CommandRejected: ({ issue }) =>
      Effect.fail(badArgument({ module: 'stryker-js', method: 'incremental-report.cell', description: issue })),
  })
