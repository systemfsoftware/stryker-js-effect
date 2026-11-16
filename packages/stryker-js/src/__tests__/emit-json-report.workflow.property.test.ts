import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  emitJsonReport,
  JsonReportCommand,
  JsonReportEmitted,
  JsonReportSuppressed,
} from '../Reporter/emit-json-report.workflow.js'

const commandArb = Arbitrary.all({
  reported: Arbitrary.schema(JsonReportCommand.fields.reported),
  debug: Arbitrary.schema(JsonReportCommand.fields.debug),
  fileName: Arbitrary.schema(JsonReportCommand.fields.fileName),
}).pipe(Arbitrary.map((fields) => JsonReportCommand.make(fields)))

describe('emitJsonReport', () => {
  it.prop(
    '∀c_Command_≡EmittedIffReportedAnnouncedIffDebug',
    {
      of: [commandArb],
      subject: emitJsonReport,
      cover: {
        unreported: [(command) => command.reported === undefined, 0.05],
        reportedDebug: [(command) => command.reported !== undefined && command.debug, 0.05],
        reportedQuiet: [(command) => command.reported !== undefined && !command.debug, 0.05],
      },
    },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => {
          const reported = command.reported
          if (reported === undefined) {
            return S.is(JsonReportSuppressed)(decision)
          }
          return S.is(JsonReportEmitted)(decision) &&
            S.toEquivalence(Report.MutationTestResult)(decision.report, reported) &&
            Option.match(decision.announceFileName, {
              onNone: () => !command.debug,
              onSome: (announced) => command.debug && announced === command.fileName,
            })
        },
      }),
  )
})
