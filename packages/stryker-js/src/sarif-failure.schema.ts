import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

const encodeUriSegment = encodeURIComponent

const uriOf = (fileName: string): string =>
  Arr.join(Arr.map(fileName.split('/'), (segment) => encodeUriSegment(segment.toWellFormed())), '/')

export const SarifFailureLocation = S.Struct({
  physicalLocation: S.Struct({
    artifactLocation: S.Struct({ uri: S.String }),
    region: S.Struct({ startLine: S.Natural, startColumn: S.Natural }),
  }),
})

export type SarifFailureLocation = typeof SarifFailureLocation.Type

export const SarifFailureNotification = S.Struct({
  descriptor: S.Struct({ id: S.String }),
  level: S.Literal('error'),
  message: S.Struct({ text: S.String }),
  locations: S.Array(SarifFailureLocation),
})

export type SarifFailureNotification = typeof SarifFailureNotification.Type

export type SarifFailureNotifications = ReadonlyArray<SarifFailureNotification>

const locatedTestsOf = (record: FailureRecord.FailureRecord): ReadonlyArray<FailureRecord.SourceLocation> =>
  Predicate.isTagged(record, 'BaselineTestsFailed')
    ? Arr.flatMap(record.tests, (test) => Option.toArray(Option.fromNullishOr(test.location)))
    : []

const locationOf = (location: FailureRecord.SourceLocation): SarifFailureLocation => ({
  physicalLocation: {
    artifactLocation: { uri: uriOf(location.file) },
    region: { startLine: location.line, startColumn: location.column },
  },
})

const notificationOf = (record: FailureRecord.FailureRecord): SarifFailureNotification => ({
  descriptor: { id: record._tag },
  level: 'error',
  message: { text: FailureRecord.sarifTextOf(record) },
  locations: Arr.map(locatedTestsOf(record), locationOf),
})

export const failureNotificationsOf = (
  records: ReadonlyArray<FailureRecord.FailureRecord>,
): SarifFailureNotifications => Arr.map(records, notificationOf)
