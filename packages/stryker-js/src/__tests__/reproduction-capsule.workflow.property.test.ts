import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'

import {
  type CapsuleDoesNotReplay,
  type CapsuleReplays,
  reproductionCapsule,
  ReproductionCapsuleCommand,
  type ReproductionCapsuleDecision,
} from '../reproduction-capsule.workflow.js'

const CWD = '/project'
const RUN_ARGV = ['stryker', 'run'] as const
const DRY_RUN_FLAG = '--dryRunOnly'
const MARKER: FailureRecord.EnvEntry = { name: 'STRYKER_WORKER_DIR', value: '.stryker-tmp' }

const capsuleOf = (evidence: FailureRecord.FailureEvidence): ReproductionCapsuleDecision =>
  Result.getOrElse(
    reproductionCapsule(
      ReproductionCapsuleCommand.make({ evidence, argv: RUN_ARGV, cwd: CWD, envMarker: MARKER }),
    ),
    (impossible) => impossible,
  )

const replaysOf = (decision: ReproductionCapsuleDecision): CapsuleReplays | undefined =>
  Predicate.isTagged(decision, 'Replays') ? decision : undefined

const refusalOf = (decision: ReproductionCapsuleDecision): CapsuleDoesNotReplay | undefined =>
  Predicate.isTagged(decision, 'DoesNotReplay') ? decision : undefined

const baselineEvidenceOf = (test: FailureRecord.FailedTestEvidence): FailureRecord.FailureEvidence => ({
  _tag: 'BaselineTestsFailed',
  stage: 'dryRun',
  testCount: 1,
  tests: [test],
})

const mutantArgvOf = (evidence: FailureRecord.FailureEvidence): string =>
  Predicate.isTagged(evidence, 'NewSurvivors')
    ? ['stryker', 'run', '--mutant', Arr.join(Arr.map(evidence.survivors, (each) => each.mutantId), ',')].join(' ')
    : ''

describe('reproductionCapsule', () => {
  it.prop(
    '∀evidence_ReproductionCapsule_≡ReplaysExactlyWhenItsCatalogCodeReplays',
    { of: [FailureRecord.FailureEvidence], subject: capsuleOf },
    (subject, [evidence]) => {
      const decision = subject(evidence)
      const rule = FailureRecord.FailureCatalog[evidence._tag].capsule
      return rule === 'replays'
        ? replaysOf(decision)?.cwd === CWD
        : refusalOf(decision)?.why === rule
    },
  )

  it.prop(
    '∀evidence_ReproductionCapsule_≡NewSurvivorFailuresReplayTheNamedMutantIds',
    { of: [FailureRecord.FailureEvidence], subject: capsuleOf },
    (subject, [evidence]) => {
      const decision = subject(evidence)
      if (!Predicate.isTagged(evidence, 'NewSurvivors')) {
        const rule = FailureRecord.FailureCatalog[evidence._tag].capsule
        return rule === 'replays' ? replaysOf(decision) !== undefined : refusalOf(decision) !== undefined
      }
      return replaysOf(decision)?.argv.join(' ') === mutantArgvOf(evidence)
    },
  )

  it.prop(
    '∀failedTest_ReproductionCapsule_≡BaselineFailuresReplayTheRunnerArgvOrFallBackToTheDryRun',
    { of: [FailureRecord.FailedTestEvidence], subject: capsuleOf },
    (subject, [failedTest]) => {
      const replays = replaysOf(subject(baselineEvidenceOf(failedTest)))
      const expectedArgv = failedTest.reproduce ?? [...RUN_ARGV, DRY_RUN_FLAG]
      return replays !== undefined && replays.cwd === CWD &&
        replays.argv.join(' ') === expectedArgv.join(' ') &&
        Arr.every(replays.env, (entry) => entry.name === MARKER.name && entry.value === MARKER.value)
    },
  )

  it.prop(
    '∀evidence_ReproductionCapsule_≡NonReplayableRecordsStandInTheirOwnEvidence',
    { of: [FailureRecord.FailureEvidence], subject: capsuleOf },
    (subject, [evidence]) => {
      const decision = subject(evidence)
      const rule = FailureRecord.FailureCatalog[evidence._tag].capsule
      if (rule === 'replays') return replaysOf(decision) !== undefined
      const refusal = refusalOf(decision)
      if (refusal === undefined) return false
      if (Predicate.isTagged(evidence, 'WorkerOutOfMemory')) {
        return refusal.standIn === `${evidence.workerKind} pid ${evidence.pid} exited ${evidence.exitCode}`
      }
      if (Predicate.isTagged(evidence, 'WorkerCrashed')) {
        return refusal.standIn.includes(`${evidence.workerKind} pid ${evidence.pid}`)
      }
      if (Predicate.isTagged(evidence, 'JobTimedOut')) return refusal.standIn.includes(`${evidence.limitSeconds}`)
      if (Predicate.isTagged(evidence, 'BinaryMissing')) return refusal.standIn.includes(evidence.binary)
      return true
    },
  )
})
