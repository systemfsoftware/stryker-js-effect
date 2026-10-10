import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class AdmitFixtureLockCommand extends S.TaggedClass<AdmitFixtureLockCommand>()('AdmitFixtureLockCommand', {
  fixtureId: S.String,
  exitCode: S.Int,
  stdout: S.String,
  stderr: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = { fixtureId: 'e2e.fixture.id' } as const
}

const LockAdmissionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/LockAdmission')
type LockAdmissionTypeId = typeof LockAdmissionTypeId

export class LockAdmitted extends S.TaggedClass<LockAdmitted>()('LockAdmitted', {
  fixtureId: S.String,
}) {
  readonly [LockAdmissionTypeId] = LockAdmissionTypeId
}

export class LockProblemsListed extends S.TaggedClass<LockProblemsListed>()('LockProblemsListed', {
  fixtureId: S.String,
  problems: S.Array(S.String),
}) {
  readonly [LockAdmissionTypeId] = LockAdmissionTypeId
}

export class LockUnreadable extends S.TaggedClass<LockUnreadable>()('LockUnreadable', {
  fixtureId: S.String,
  detail: S.String,
}) {
  readonly [LockAdmissionTypeId] = LockAdmissionTypeId
}

export const LockAdmission = S.Union([LockAdmitted, LockProblemsListed, LockUnreadable])
export type LockAdmission = typeof LockAdmission.Type

const NpmLsReportJson = S.fromJsonString(S.Struct({
  problems: S.String.pipe(S.Array, S.optionalKey),
  error: S.optionalKey(S.Struct({ code: S.optionalKey(S.String), summary: S.optionalKey(S.String) })),
}))

type NpmLsReport = typeof NpmLsReportJson.Type

const decodeLsReport = S.decodeOption(NpmLsReportJson)

const nonBlank = (text: string): boolean => text.length > 0

const problemsOf = (report: NpmLsReport): Option.Option<ReadonlyArray<string>> =>
  Option.filter(Option.fromUndefinedOr(report.problems), (problems) => problems.length > 0)

const npmErrorOf = (report: NpmLsReport): Option.Option<string> =>
  pipe(
    Option.fromUndefinedOr(report.error),
    Option.map((error) => [error.code, error.summary].filter((part) => part !== undefined).join(': ')),
    Option.filter(nonBlank),
  )

const detailOf = (command: AdmitFixtureLockCommand, report: Option.Option<NpmLsReport>): string =>
  pipe(
    Option.flatMap(report, npmErrorOf),
    Option.orElse(() => Option.filter(Option.fromUndefinedOr(command.stderr.trim().split('\n')[0]), nonBlank)),
    Option.getOrElse(() => `npm ls exited ${command.exitCode} without a report`),
  )

const failedListingOf = (command: AdmitFixtureLockCommand): LockAdmission => {
  const report = decodeLsReport(command.stdout)
  return Option.match(Option.flatMap(report, problemsOf), {
    onSome: (problems) => LockProblemsListed.make({ fixtureId: command.fixtureId, problems }),
    onNone: () => LockUnreadable.make({ fixtureId: command.fixtureId, detail: detailOf(command, report) }),
  })
}

const decide = (command: AdmitFixtureLockCommand): Result.Result<LockAdmission, never> =>
  Result.succeed(Boolean.match(command.exitCode === 0, {
    onTrue: (): LockAdmission => LockAdmitted.make({ fixtureId: command.fixtureId }),
    onFalse: () => failedListingOf(command),
  }))

export const admitFixtureLock = Workflow.make({
  command: AdmitFixtureLockCommand,
  decision: LockAdmission,
  error: S.Never,
  decide,
})
