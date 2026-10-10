import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ReuseReportSchema } from './IncrementalDiff.schema.js'

export class AdmitReuseSourceCommand extends S.TaggedClass<AdmitReuseSourceCommand>()('AdmitReuseSourceCommand', {
  text: S.String,
  expectedIncrementalVersion: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    expectedIncrementalVersion: 'stryker.incremental_source.expected_version',
  } as const
}

const AdmitReuseSourceTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/AdmitReuseSourceDecision')
type AdmitReuseSourceTypeId = typeof AdmitReuseSourceTypeId

export class ReuseSourceKept extends S.TaggedClass<ReuseSourceKept>()('ReuseSourceKept', {
  report: ReuseReportSchema,
}) {
  readonly [AdmitReuseSourceTypeId] = AdmitReuseSourceTypeId
}

export class ReuseSourceAbsent extends S.TaggedClass<ReuseSourceAbsent>()('ReuseSourceAbsent', {}) {
  readonly [AdmitReuseSourceTypeId] = AdmitReuseSourceTypeId
}

const ReuseSourceDiscardReason = S.Literals(['cacheLayoutChanged', 'undecodable'])
type ReuseSourceDiscardReason = typeof ReuseSourceDiscardReason.Type

export class ReuseSourceDiscarded extends S.TaggedClass<ReuseSourceDiscarded>()('ReuseSourceDiscarded', {
  reason: ReuseSourceDiscardReason,
  actual: S.optional(S.String),
  expected: S.String,
  issue: S.optional(S.String),
}) {
  readonly [AdmitReuseSourceTypeId] = AdmitReuseSourceTypeId
}

export type AdmitReuseSourceDecision = ReuseSourceKept | ReuseSourceAbsent | ReuseSourceDiscarded

const IncrementalVersionHeaderSchema = S.Struct({ incrementalVersion: S.String })

const decodeIssueOf = (error: S.SchemaError): string => error.message.replace(/\s+/gu, ' ').trim()

const layoutDiscardOf = (command: AdmitReuseSourceCommand, actual: string | undefined): ReuseSourceDiscarded =>
  ReuseSourceDiscarded.make({
    reason: 'cacheLayoutChanged',
    actual,
    expected: command.expectedIncrementalVersion,
  })

const decodeReportOf = (command: AdmitReuseSourceCommand): AdmitReuseSourceDecision =>
  Result.match(S.decodeResult(S.fromJsonString(ReuseReportSchema))(command.text), {
    onFailure: (error): AdmitReuseSourceDecision =>
      ReuseSourceDiscarded.make({
        reason: 'undecodable',
        expected: command.expectedIncrementalVersion,
        issue: decodeIssueOf(error),
      }),
    onSuccess: (report): AdmitReuseSourceDecision => ReuseSourceKept.make({ report }),
  })

const decide = (command: AdmitReuseSourceCommand): AdmitReuseSourceDecision =>
  Boolean.match(command.text.length === 0, {
    onTrue: () => ReuseSourceAbsent.make({}),
    onFalse: () =>
      Option.match(S.decodeOption(S.fromJsonString(IncrementalVersionHeaderSchema))(command.text), {
        onNone: () => layoutDiscardOf(command, undefined),
        onSome: (header) =>
          Boolean.match(header.incrementalVersion !== command.expectedIncrementalVersion, {
            onTrue: () => layoutDiscardOf(command, header.incrementalVersion),
            onFalse: () => decodeReportOf(command),
          }),
      }),
  })

export const admitReuseSource = Workflow.make({
  command: AdmitReuseSourceCommand,
  decision: S.Union([ReuseSourceKept, ReuseSourceAbsent, ReuseSourceDiscarded]),
  error: S.Never,
  decide: (command): Result.Result<AdmitReuseSourceDecision, never> => Result.succeed(decide(command)),
})
