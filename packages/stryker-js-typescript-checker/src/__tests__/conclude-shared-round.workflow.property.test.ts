import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ConcludeSharedRoundCommand } from '../CheckerCommands.schema.js'
import { SharedRoundKept } from '../CheckRound.schema.js'
import { concludeSharedRound } from '../conclude-shared-round.workflow.js'
import { ShortcutTaken } from '../ImporterShortcut.schema.js'

const kept = (command: ConcludeSharedRoundCommand): boolean =>
  Result.match(concludeSharedRound(command), {
    onFailure: () => false,
    onSuccess: (conclusion) => S.is(SharedRoundKept)(conclusion),
  })

describe('concludeSharedRound', (it) => {
  it.prop(
    '∀command_Conclusion_≡KeptWhenEveryMemberOfANonEmptyRoundTookTheShortcut',
    { of: [ConcludeSharedRoundCommand], subject: kept },
    (subject, [command]) =>
      subject(
        ConcludeSharedRoundCommand.make({
          decisions: Arr.map(command.decisions, () => Option.some(ShortcutTaken.make({}))),
        }),
      ) === Arr.isReadonlyArrayNonEmpty(command.decisions),
  )

  it.prop(
    '∀command_Conclusion_≡IndependentOfMemberOrder',
    { of: [ConcludeSharedRoundCommand], subject: kept },
    (subject, [command]) =>
      subject(command) === subject(ConcludeSharedRoundCommand.make({ decisions: Arr.reverse(command.decisions) })),
  )
})
