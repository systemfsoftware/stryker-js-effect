import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { FeedbackRecorded, recordFeedback, RecordFeedbackCommand } from '../Feedback/record-feedback.workflow.js'

const commandArb = Arbitrary.schema(RecordFeedbackCommand)

const decidedOf = (subject: typeof recordFeedback, command: RecordFeedbackCommand) =>
  Result.getOrThrow(subject(command))

describe('recordFeedback', () => {
  it.prop(
    '∀c_RecordFeedbackCommandWithASurfacedId_≡RecordsExactlyThatJudgment',
    { of: [commandArb], subject: recordFeedback },
    (subject, [command]) => {
      const drawn = Arr.head(command.knownIds)
      const id = Option.getOrElse(drawn, () => command.id)
      const knownIds: ReadonlyArray<Mutant.MutantId> = Option.isSome(drawn) ? command.knownIds : [id]
      const decision = decidedOf(
        subject,
        RecordFeedbackCommand.make({
          id,
          judgment: command.judgment,
          reason: command.reason,
          knownIds,
        }),
      )
      return S.is(FeedbackRecorded)(decision) &&
        decision.id === id &&
        decision.judgment === command.judgment &&
        decision.reason === command.reason
    },
  )
})
