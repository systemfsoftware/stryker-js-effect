import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ConcludeSharedRoundCommand } from './CheckerCommands.schema.js'
import { SharedRoundConclusion, SharedRoundKept, SharedRoundRedone } from './CheckRound.schema.js'
import { takesShortcut } from './ImporterShortcut.schema.js'

const everyMemberTakesShortcut = (command: ConcludeSharedRoundCommand): boolean =>
  Boolean.and(
    Arr.isReadonlyArrayNonEmpty(command.decisions),
    Arr.every(command.decisions, (decision) => Option.exists(decision, takesShortcut)),
  )

const decide = (command: ConcludeSharedRoundCommand): Result.Result<SharedRoundConclusion, never> =>
  Result.succeed(
    Boolean.match(everyMemberTakesShortcut(command), {
      onTrue: (): SharedRoundConclusion => SharedRoundKept.make({}),
      onFalse: (): SharedRoundConclusion => SharedRoundRedone.make({}),
    }),
  )

export const concludeSharedRound = Workflow.make({
  command: ConcludeSharedRoundCommand,
  decision: SharedRoundConclusion,
  error: S.Never,
  decide,
})
