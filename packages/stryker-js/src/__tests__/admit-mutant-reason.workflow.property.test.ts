import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitMutantReason,
  MutantReasonCommand,
  ReasonAdmitted,
  ReasonRefused,
} from '../admit-mutant-reason.workflow.js'

const commandArb = Arbitrary.schema(MutantReasonCommand)

const encodeStatusReason = S.encodeOption(Mutant.StatusReason)

const CODE_SEPARATOR_COLON = ':'

const refused = (subject: typeof admitMutantReason, command: MutantReasonCommand) => {
  const result = subject(command)
  return Result.isSuccess(result) && S.is(ReasonRefused)(result.success)
}

describe('admitMutantReason', () => {
  it.prop(
    '∀c_PendingCommand_≡Refused',
    { of: [commandArb], subject: admitMutantReason },
    (subject, [command]) =>
      refused(subject, MutantReasonCommand.make({ status: 'Pending', statusReason: command.statusReason })),
  )

  it.prop(
    '∀c_CommandWithoutReason_≡Refused',
    { of: [commandArb], subject: admitMutantReason },
    (subject, [command]) =>
      refused(subject, MutantReasonCommand.make({ status: command.status, statusReason: undefined })),
  )

  it.prop(
    '∀sr_ReasonFromItsStatusVocabulary_≡AdmittedWithThatStatusAndReason',
    { of: [Mutant.StatusReason], subject: admitMutantReason },
    (subject, [reason]) =>
      Option.match(encodeStatusReason(reason), {
        onNone: () => false,
        onSome: (encoded) => {
          const result = subject(
            MutantReasonCommand.make({ status: encoded.status, statusReason: encoded.statusReason }),
          )
          return Result.isSuccess(result) &&
            S.is(ReasonAdmitted)(result.success) &&
            result.success.status === encoded.status &&
            result.success.statusReason === encoded.statusReason
        },
      }),
  )

  it.prop(
    '∀ct_CommandWhoseReasonNamesNoCode_≡Refused',
    { of: [commandArb, S.String], subject: admitMutantReason },
    (subject, [command, text]) =>
      refused(
        subject,
        MutantReasonCommand.make({ status: command.status, statusReason: text.replaceAll(CODE_SEPARATOR_COLON, ' ') }),
      ),
  )
})
