import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitStreamOverwrite,
  OverwriteAllowed,
  OverwriteRefused,
  StreamOverwriteCommand,
} from '../admit-stream-overwrite.workflow.js'

const commandArb = Arbitrary.schema(StreamOverwriteCommand)

const decidedAs = (
  subject: typeof admitStreamOverwrite,
  decision: typeof OverwriteAllowed | typeof OverwriteRefused,
  command: StreamOverwriteCommand,
) => {
  const result = subject(command)
  return Result.isSuccess(result) && S.is(decision)(result.success) && result.success.file === command.file
}

describe('admitStreamOverwrite', () => {
  it.prop(
    '∀c_RegularFileStartingWithAStreamHeader_≡Allowed',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      decidedAs(
        subject,
        OverwriteAllowed,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          leadingText: `{"_tag":"stream","schemaVersion":"8.0"}\n${command.leadingText}`,
        }),
      ),
  )

  it.prop(
    '∀c_RegularFileWhoseFirstLineIsNoJson_≡Refused',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      decidedAs(
        subject,
        OverwriteRefused,
        StreamOverwriteCommand.make({ file: command.file, regularFile: true, leadingText: `x${command.leadingText}` }),
      ),
  )

  it.prop(
    '∀c_EmptyRegularFile_≡Allowed',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      decidedAs(
        subject,
        OverwriteAllowed,
        StreamOverwriteCommand.make({ file: command.file, regularFile: true, leadingText: '' }),
      ),
  )

  it.prop(
    '∀c_NoRegularFile_≡AllowedWhateverItsText',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      decidedAs(
        subject,
        OverwriteAllowed,
        StreamOverwriteCommand.make({ file: command.file, regularFile: false, leadingText: command.leadingText }),
      ),
  )
})
