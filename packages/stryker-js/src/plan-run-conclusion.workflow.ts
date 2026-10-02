import { Workflow } from '@systemfsoftware/effect-cell-types'
import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type RunFailed, RunOk, RunOutcomeDecision, type RunVerdictFailed } from './classify-run-outcome.workflow.js'

const PlanRunConclusionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/PlanRunConclusion')
type PlanRunConclusionTypeId = typeof PlanRunConclusionTypeId

export class PlanRunConclusionCommand extends S.TaggedClass<PlanRunConclusionCommand>()('PlanRunConclusionCommand', {
  decision: RunOutcomeDecision,
  machine: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    machine: 'stryker.run_conclusion.machine',
  } as const
}

export class RunConclusionEmittedOk extends S.TaggedClass<RunConclusionEmittedOk>()('RunConclusionEmittedOk', {
  ok: RunOk,
}) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionQuietOk extends S.TaggedClass<RunConclusionQuietOk>()('RunConclusionQuietOk', {}) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionVerdictFailed extends S.TaggedClass<RunConclusionVerdictFailed>()(
  'RunConclusionVerdictFailed',
  { exitCode: Plugin.ExitCode },
) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionFailed extends S.TaggedClass<RunConclusionFailed>()('RunConclusionFailed', {
  exitCode: Plugin.ExitCode,
  record: FailureRecord.FailureRecord,
}) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export const PlanRunConclusionDecision = S.Union([
  RunConclusionEmittedOk,
  RunConclusionQuietOk,
  RunConclusionVerdictFailed,
  RunConclusionFailed,
])
export type PlanRunConclusionDecision = typeof PlanRunConclusionDecision.Type

const okConclusionOf = (ok: RunOk, machine: boolean): PlanRunConclusionDecision =>
  Boolean.match(machine, {
    onTrue: () => RunConclusionEmittedOk.make({ ok }),
    onFalse: () => RunConclusionQuietOk.make({}),
  })

const verdictConclusionOf = (failed: RunVerdictFailed): PlanRunConclusionDecision =>
  RunConclusionVerdictFailed.make({ exitCode: failed.code })

const failedConclusionOf = (failed: RunFailed): PlanRunConclusionDecision =>
  RunConclusionFailed.make({ exitCode: failed.code, record: failed.record })

const decide = (command: PlanRunConclusionCommand): Result.Result<PlanRunConclusionDecision, never> =>
  Result.succeed(
    Match.value(command.decision).pipe(
      Match.tag('RunOk', (ok) => okConclusionOf(ok, command.machine)),
      Match.tag('RunVerdictFailed', verdictConclusionOf),
      Match.tag('RunFailed', failedConclusionOf),
      Match.exhaustive,
    ),
  )

export const planRunConclusion = Workflow.make({
  command: PlanRunConclusionCommand,
  decision: PlanRunConclusionDecision,
  error: S.Never,
  decide,
})
