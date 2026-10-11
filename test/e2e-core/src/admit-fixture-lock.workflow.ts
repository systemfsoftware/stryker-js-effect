import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { LockListingJson } from './npm-wire.schema.js'

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

const decodeListing = S.decodeOption(LockListingJson)

const nonBlank = (text: string): boolean => text.length > 0

const unreadableDetailOf = (command: AdmitFixtureLockCommand, detail: string): string =>
  pipe(
    Option.filter(Option.some(detail), nonBlank),
    Option.orElse(() => Option.filter(Option.fromUndefinedOr(command.stderr.trim().split('\n')[0]), nonBlank)),
    Option.getOrElse(() => `npm ls exited ${command.exitCode} without a report`),
  )

const failedListingOf = (command: AdmitFixtureLockCommand): LockAdmission =>
  Option.match(decodeListing(command.stdout), {
    onSome: (listing) =>
      Match.value(listing).pipe(
        Match.tag(
          'LockProblemReport',
          ({ problems }): LockAdmission => LockProblemsListed.make({ fixtureId: command.fixtureId, problems }),
        ),
        Match.tag(
          'LockUnreadableReport',
          ({ detail }): LockAdmission =>
            LockUnreadable.make({ fixtureId: command.fixtureId, detail: unreadableDetailOf(command, detail) }),
        ),
        Match.exhaustive,
      ),
    onNone: () => LockUnreadable.make({ fixtureId: command.fixtureId, detail: unreadableDetailOf(command, '') }),
  })

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
