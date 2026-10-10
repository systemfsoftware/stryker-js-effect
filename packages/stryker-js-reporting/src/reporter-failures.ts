import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'

const failAsReporter = (reporterName: string) => <E = unknown>(cause: E): Reporter.ReporterFailed =>
  Reporter.ReporterFailed.make({
    reporterName,
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
  })

export const failAsClearText = failAsReporter('clear-text')

export const failAsJsonReporter = failAsReporter('json')

export const failAsProgress = failAsReporter('progress')
