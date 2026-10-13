import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitStreamOverwrite,
  OverwriteAllowed,
  OverwriteRefused,
  StreamOverwriteCommand,
} from '../admit-stream-overwrite.workflow.js'

const commandArb = Arbitrary.schema(StreamOverwriteCommand)

const eventArb = Arbitrary.schema(RunEvent.RunEvent)

const encodeLine = S.encodeOption(RunEvent.RunEventWireLine)

const allowed = (subject: typeof admitStreamOverwrite, command: StreamOverwriteCommand) => {
  const result = subject(command)
  return Result.isSuccess(result) && S.is(OverwriteAllowed)(result.success) && result.success.file === command.file
}

const refused = (subject: typeof admitStreamOverwrite, command: StreamOverwriteCommand) => {
  const result = subject(command)
  return Result.isSuccess(result) && S.is(OverwriteRefused)(result.success) && result.success.file === command.file &&
    result.success.reason.includes('will not overwrite')
}

describe('admitStreamOverwrite', () => {
  it.prop(
    '∀ec_RegularFileStartingWithAnyRunEventRecord_≡Allowed',
    { of: [Arbitrary.all({ event: eventArb, command: commandArb })], subject: admitStreamOverwrite },
    (subject, [draw]) =>
      Option.match(encodeLine(draw.event), {
        onNone: () => false,
        onSome: (line) =>
          allowed(
            subject,
            StreamOverwriteCommand.make({
              file: draw.command.file,
              regularFile: true,
              empty: false,
              leadingText: `${line}\n${draw.command.leadingText}`,
            }),
          ),
      }),
  )

  it.prop(
    '∀c_RegularFileStartingWithAStreamHeaderOfAnyVersion_≡Allowed',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      allowed(
        subject,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          empty: false,
          leadingText: `${
            JSON.stringify({ _tag: 'stream', schemaVersion: command.leadingText })
          }\n${command.leadingText}`,
        }),
      ),
  )

  it.prop(
    '∀c_RegularFileWhoseFirstLineIsNoJson_≡Refused',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      refused(
        subject,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          empty: false,
          leadingText: `x${command.leadingText}`,
        }),
      ),
  )

  it.prop(
    '∀c_RegularFileWhoseFirstLineIsJsonWithAForeignTag_≡Refused',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      refused(
        subject,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          empty: false,
          leadingText: `${JSON.stringify({ _tag: `note:${command.leadingText}` })}\n${command.leadingText}`,
        }),
      ),
  )

  it.prop(
    '∀c_EmptyRegularFile_≡AllowedWhateverItsText',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      allowed(
        subject,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          empty: true,
          leadingText: command.leadingText,
        }),
      ),
  )

  it.prop(
    '∀c_NonEmptyRegularFileWithNoDecodableText_≡Refused',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      refused(
        subject,
        StreamOverwriteCommand.make({ file: command.file, regularFile: true, empty: false, leadingText: '' }),
      ),
  )

  it.prop(
    '∀c_RegularFileStartingWithABlankLine_≡Refused',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      refused(
        subject,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          empty: false,
          leadingText: `\n${command.leadingText}`,
        }),
      ),
  )

  it.prop(
    '∀c_NoRegularFile_≡AllowedWhateverItsText',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      allowed(
        subject,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: false,
          empty: command.empty,
          leadingText: command.leadingText,
        }),
      ),
  )
})
