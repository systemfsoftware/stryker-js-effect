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
              wholeFileRead: false,
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
          wholeFileRead: false,
          leadingText: `${
            JSON.stringify({ _tag: 'stream', schemaVersion: command.leadingText, runId: command.file })
          }\n${command.leadingText}`,
        }),
      ),
  )

  it.prop(
    '∀ec_WholeFileHoldingATornRunEventRecord_≡Allowed',
    { of: [Arbitrary.all({ event: eventArb, command: commandArb })], subject: admitStreamOverwrite },
    (subject, [draw]) =>
      Option.match(encodeLine(draw.event), {
        onNone: () => false,
        onSome: (line) =>
          Array.from({ length: line.length - 1 }, (_, index) => line.slice(0, index + 1)).every((torn) =>
            allowed(
              subject,
              StreamOverwriteCommand.make({
                file: draw.command.file,
                regularFile: true,
                empty: false,
                wholeFileRead: true,
                leadingText: torn,
              }),
            )
          ),
      }),
  )

  it.prop(
    '∀ec_TornRunEventRecordFromAPartialRead_≡Refused',
    { of: [Arbitrary.all({ event: eventArb, command: commandArb })], subject: admitStreamOverwrite },
    (subject, [draw]) =>
      Option.match(encodeLine(draw.event), {
        onNone: () => false,
        onSome: (line) =>
          refused(
            subject,
            StreamOverwriteCommand.make({
              file: draw.command.file,
              regularFile: true,
              empty: false,
              wholeFileRead: false,
              leadingText: line.trimEnd().slice(0, -1),
            }),
          ),
      }),
  )

  it.prop(
    '∀c_WholeFileHoldingOnlyABareStreamObject_≡Refused',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      refused(
        subject,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          empty: false,
          wholeFileRead: true,
          leadingText: JSON.stringify({ _tag: 'stream', tool: command.file }),
        }),
      ),
  )

  it.prop(
    '∀ec_WholeFileHoldingAClosedRecordFollowedByText_≡Refused',
    { of: [Arbitrary.all({ event: eventArb, command: commandArb })], subject: admitStreamOverwrite },
    (subject, [draw]) =>
      Option.match(encodeLine(draw.event), {
        onNone: () => false,
        onSome: (line) =>
          refused(
            subject,
            StreamOverwriteCommand.make({
              file: draw.command.file,
              regularFile: true,
              empty: false,
              wholeFileRead: true,
              leadingText: `${line.trimEnd()}x${draw.command.leadingText.replaceAll('\n', '')}`,
            }),
          ),
      }),
  )

  it.prop(
    '∀c_RegularFileStartingWithABareStreamObject_≡Refused',
    { of: [commandArb], subject: admitStreamOverwrite },
    (subject, [command]) =>
      refused(
        subject,
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          empty: false,
          wholeFileRead: command.wholeFileRead,
          leadingText: `${JSON.stringify({ _tag: 'stream', tool: command.file })}\n${command.leadingText}`,
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
          wholeFileRead: false,
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
          wholeFileRead: false,
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
          wholeFileRead: command.wholeFileRead,
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
        StreamOverwriteCommand.make({
          file: command.file,
          regularFile: true,
          empty: false,
          wholeFileRead: command.wholeFileRead,
          leadingText: '',
        }),
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
          wholeFileRead: false,
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
          wholeFileRead: command.wholeFileRead,
          leadingText: command.leadingText,
        }),
      ),
  )
})
