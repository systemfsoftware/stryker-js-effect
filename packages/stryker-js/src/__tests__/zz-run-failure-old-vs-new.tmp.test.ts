import { describe, it } from '@effect/vitest'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Exit from 'effect/Exit'
import * as Result from 'effect/Result'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import * as fc from 'fast-check'

import {
  classifyRunOutcome,
  RunConfigFailed,
  RunFailed,
  RunInterrupted,
  RunOutcomeCommand,
  RunParseFailed,
  RunSurvivorsRejected,
  type FailedRunOutcome,
  type RunOutcomeDecision,
  type RunOutcomeError,
} from '../classify-run-outcome.workflow.js'
import { ErrorEnvelope, RunExitCode } from '../reporting/run-failure.schema.js'

const BASELINE_ENVELOPE = '/tmp/refactor/baseline/packages/stryker-js/src/Envelope.ts'

const EXIT_CLASSES: readonly ExitClass[] = ['VerdictFail', 'ConfigError', 'RuntimeError', 'InternalError']

const chainOf = (depth: number, cycle: boolean): object => {
  const head: { cause?: unknown } = {}
  let node = head
  for (let index = 1; index < depth; index += 1) {
    const next: { cause?: unknown } = {}
    node.cause = next
    node = next
  }
  if (cycle) {
    node.cause = head
  }
  return head
}

const sharedNode = { exitClass: 'ConfigError', reason: 'the config is bad' }
const diamondNode = { cause: [sharedNode, sharedNode], exitClass: 'RuntimeError' }

const causeArb = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' },
    fc.string({ maxLength: 12 }),
    fc.integer(),
    fc.record({ message: fc.string({ minLength: 1, maxLength: 12 }) }),
    fc.record({ reason: fc.string({ minLength: 1, maxLength: 12 }), cause: tie('node') }),
    fc.record({ cause: tie('node') }),
    fc.array(tie('node'), { maxLength: 3 }).map((causes) => ({ cause: causes })),
    fc.record({ exitClass: fc.constantFrom(...EXIT_CLASSES) }),
    fc.record({ exitClass: fc.constantFrom(...EXIT_CLASSES), reason: fc.string({ minLength: 1, maxLength: 12 }) }),
  ),
})).node

const exitArb = fc.oneof(
  causeArb.map((defect) => Exit.die(defect)),
  fc.oneof(
    fc.string({ maxLength: 16 }),
    fc.record({ reason: fc.string({ minLength: 1, maxLength: 12 }) }),
    fc.record({ cause: causeArb }),
    fc.record({ exitClass: fc.constantFrom(...EXIT_CLASSES) }),
    fc.record({ exitClass: fc.constantFrom(...EXIT_CLASSES), cause: causeArb }),
    fc.string({ minLength: 1, maxLength: 12 }).map((message) => new Error(message)),
  ).map((error) => Exit.fail(error)),
  fc.constant(Exit.interrupt()),
  fc.constantFrom(...EXIT_CLASSES).map((verdict) => Exit.succeed({ verdict })),
  fc.constant(Exit.succeed(undefined)),
  fc.integer({ min: 3, max: 40 }).map((depth) => Exit.die(chainOf(depth, false))),
  fc.integer({ min: 2, max: 12 }).map((depth) => Exit.die(chainOf(depth, true))),
  fc.constant(Exit.fail(diamondNode)),
  fc.constant(Exit.die({ cause: diamondNode, reason: 'outer' })),
)

const argvArb = fc.array(
  fc.oneof(fc.constant('--logLevel'), fc.constant('debug'), fc.constant('-f'), fc.string({ maxLength: 8 })),
  { maxLength: 5 },
)

const capturedArb = fc.string({ maxLength: 40 })

const failedOutcomeArb: fc.Arbitrary<FailedRunOutcome> = fc.oneof(
  fc.integer({ min: -3, max: 200 }).map((code) => RunInterrupted.make({ code })),
  fc.option(fc.string({ maxLength: 12 }), { nil: undefined }).map((unrecognized) =>
    RunParseFailed.make({ unrecognized })),
  fc.tuple(fc.constantFrom('no-report', 'mismatch'), fc.option(fc.string({ maxLength: 20 }), { nil: undefined }))
    .map(([reason, diagnostic]) => RunSurvivorsRejected.make({ reason, diagnostic })),
  fc.option(fc.string({ maxLength: 20 }), { nil: undefined }).map((detail) => RunConfigFailed.make({ detail })),
  fc.tuple(fc.integer({ min: 1, max: 4 }), fc.option(fc.string({ maxLength: 20 }), { nil: undefined }))
    .map(([code, diagnostic]) => RunFailed.make({ code, diagnostic })),
)

interface OutcomeShape {
  readonly _tag: string
  readonly help?: boolean
  readonly unrecognized?: string
  readonly reason?: string
  readonly diagnostic?: string
  readonly detail?: string
  readonly code?: number
}

const shapeOf = (value: OutcomeShape): string => {
  if (value._tag === 'RunOk') {
    return `RunOk|${value.help}`
  }
  if (value._tag === 'RunParseFailed') {
    return `RunParseFailed|${value.unrecognized ?? ''}`
  }
  if (value._tag === 'RunSurvivorsRejected') {
    return `RunSurvivorsRejected|${value.reason}|${value.diagnostic ?? ''}`
  }
  if (value._tag === 'RunConfigFailed') {
    return `RunConfigFailed|${value.detail ?? ''}`
  }
  if (value._tag === 'RunFailed') {
    return `RunFailed|${value.code}|${value.diagnostic ?? ''}`
  }
  return `RunInterrupted|${value.code}`
}

const codeOfOutcome = (outcome: RunOutcomeDecision | RunOutcomeError) => RunExitCode.fromOutcome(outcome).code

const baselineModule = existsSync(BASELINE_ENVELOPE)
  ? await import(pathToFileURL(BASELINE_ENVELOPE).href)
  : undefined

describe('run-failure old vs new', () => {
  if (baselineModule === undefined) {
    it.skip('baseline Envelope.ts missing')
    return
  }
  const baseline = baselineModule

  it.prop('∀exit_argv_GatheredCommandClassify_≡Baseline', [exitArb, argvArb], ([exit, argv]) => {
    const theirs = baseline.classifyRunOutcome(exit, argv)
    const theirsShape = shapeOf(theirs._tag === 'Success' ? theirs.success : theirs.failure)
    return Result.match(classifyRunOutcome(RunOutcomeCommand.fromExit({ exit, argv })), {
      onSuccess: (decision) => theirsShape === shapeOf(decision),
      onFailure: (interrupted) => theirsShape === shapeOf(interrupted),
    })
  })

  it.prop('∀exit_argv_ExitCode_≡Baseline', [exitArb, argvArb], ([exit, argv]) => {
    const theirsCode = baseline.runOutcomeCode(baseline.classifyRunOutcome(exit, argv))
    return Result.match(classifyRunOutcome(RunOutcomeCommand.fromExit({ exit, argv })), {
      onSuccess: (decision) => theirsCode === codeOfOutcome(decision),
      onFailure: (interrupted) => theirsCode === codeOfOutcome(interrupted),
    })
  })

  it.prop('∀exit_Diagnostic_≡Baseline', [exitArb, argvArb], ([exit, argv]) => {
    const command = RunOutcomeCommand.fromExit({ exit, argv })
    const theirs = baseline.describeFailure(exit)
    return theirs === 'Unknown failure' ? command.diagnostic === undefined : command.diagnostic === theirs
  })

  it.prop('∀error_captured_FailureText_≡Baseline', [failedOutcomeArb, capturedArb], ([error, captured]) =>
    baseline.errorText(error, captured) === ErrorEnvelope.fromOutcome({ error, captured }).error)

  it.prop('∀error_captured_EnvelopeShape_≡Baseline', [failedOutcomeArb, capturedArb], ([error, captured]) => {
    const theirs = baseline.shapeEnvelope(error, captured)
    const ours = ErrorEnvelope.fromOutcome({ error, captured })
    return theirs.schemaVersion === ours.schemaVersion && theirs.code === ours.code &&
      theirs.error === ours.error && theirs.remediation === ours.remediation
  })
})
