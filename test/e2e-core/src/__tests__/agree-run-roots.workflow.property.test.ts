import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { agreeRunRoots, AgreeRunRootsCommand } from '../agree-run-roots.workflow.js'
import { BENCH_ORDER } from '../bench-order.js'
import { BenchRunKey, BenchRunMeasured, type RunIdentity } from '../bench-run.schema.js'
import { RunRootsAgreed, RunRootsDiffer } from '../run-path.schema.js'

interface Digests {
  readonly runInputsDigest: string
  readonly mutantIdsDigest: string
}

const SAME: Digests = { runInputsDigest: 'inputs', mutantIdsDigest: 'ids' }

const identityOf = (projectRoot: string, unread: boolean, digests: Digests): RunIdentity =>
  unread
    ? { _tag: 'unread', reason: 'incremental report missing' }
    : { _tag: 'read', projectRoot, ...digests }

const runAt = (position: number, projectRoot: string, unread: boolean, digests: Digests = SAME): BenchRunMeasured =>
  BenchRunMeasured.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: BENCH_ORDER[position], position }),
    phaseDurations: {
      prepare: 0,
      instrument: 0,
      'dry-run': 0,
      'mutation-test': 1,
      check: { _tag: 'not-recorded' },
      reporting: { _tag: 'measured', ms: 0 },
    },
    mutants: 10,
    testsExecuted: 2,
    workloadDigest: { _tag: 'verified', digest: 'digest-entry' },
    identity: identityOf(projectRoot, unread, digests),
    wallMs: 1,
    exitCode: 0,
  })

describe('agreeRunRoots', () => {
  it.prop(
    '∀arr_AnyRootAtAnyPositionOfTheLeg_≡DifferIffAReadRootDisagreesNamingBoth',
    {
      of: [S.NonEmptyString, S.NonEmptyString, S.Int.check(S.isBetween({ minimum: 1, maximum: 7 })), S.Boolean],
      subject: agreeRunRoots,
    },
    (subject, [root, odd, oddPosition, oddUnread]) => {
      const runs = BENCH_ORDER.map((_, position) =>
        position === oddPosition ? runAt(position, odd, oddUnread) : runAt(position, root, false)
      )
      const disagrees = !oddUnread && odd !== root
      return Result.match(subject(AgreeRunRootsCommand.make({ runs })), {
        onSuccess: (agreed) => !disagrees && S.is(RunRootsAgreed)(agreed) && agreed.projectRoot === root,
        onFailure: (differ) =>
          disagrees &&
          S.is(RunRootsDiffer)(differ) &&
          differ.first.projectRoot === root &&
          differ.other.projectRoot === odd &&
          differ.other.key.position === oddPosition,
      })
    },
  )

  it.prop(
    '∀ard_AnyDigestsAndIdSetsUnderOneRoot_≡AgreedOnThatRoot',
    {
      of: [S.NonEmptyString, S.NonEmptyString, S.NonEmptyString, S.Int.check(S.isBetween({ minimum: 1, maximum: 7 }))],
      subject: agreeRunRoots,
    },
    (subject, [root, runInputsDigest, mutantIdsDigest, oddPosition]) => {
      const runs = BENCH_ORDER.map((_, position) =>
        position === oddPosition
          ? runAt(position, root, false, { runInputsDigest, mutantIdsDigest })
          : runAt(position, root, false)
      )
      const agreed = subject(AgreeRunRootsCommand.make({ runs }))
      return Result.isSuccess(agreed) && agreed.success.projectRoot === root
    },
  )
})
