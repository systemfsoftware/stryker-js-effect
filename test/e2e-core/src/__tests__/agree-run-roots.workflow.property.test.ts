import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { agreeRunRoots, AgreeRunRootsCommand } from '../agree-run-roots.workflow.js'
import { BENCH_ORDER } from '../bench-order.js'
import { BenchRunKey, BenchRunMeasured, RunIdentity } from '../bench-run.schema.js'
import { RunIdentityUnreadable, RunRootsAgreed, RunRootsDiffer } from '../run-path.schema.js'

interface Digests {
  readonly runInputsDigest: string
  readonly mutantIdsDigest: string
}

const SAME: Digests = { runInputsDigest: 'inputs', mutantIdsDigest: 'ids' }

const readAt = (projectRoot: string, digests: Digests = SAME): RunIdentity => ({
  _tag: 'read',
  projectRoot,
  ...digests,
})

const runAt = (position: number, identity: RunIdentity): BenchRunMeasured =>
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
    identity,
    wallMs: 1,
    exitCode: 0,
  })

describe('agreeRunRoots', () => {
  it.prop(
    '∀arr_AnyIdentityAtAnyPositionOfTheLeg_≡RefusedIffItIsUnreadOrItsRootDisagrees',
    {
      of: [S.NonEmptyString, RunIdentity, S.Int.check(S.isBetween({ minimum: 1, maximum: 7 }))],
      subject: agreeRunRoots,
    },
    (subject, [root, odd, oddPosition]) => {
      const runs = BENCH_ORDER.map((_, position) => runAt(position, position === oddPosition ? odd : readAt(root)))
      const unread = S.is(RunIdentity.cases.unread)(odd)
      const disagrees = S.is(RunIdentity.cases.read)(odd) && odd.projectRoot !== root
      return Result.match(subject(AgreeRunRootsCommand.make({ runs })), {
        onSuccess: (agreed) => !unread && !disagrees && S.is(RunRootsAgreed)(agreed) && agreed.projectRoot === root,
        onFailure: (refused) =>
          unread
            ? S.is(RunIdentityUnreadable)(refused) &&
              refused.key.position === oddPosition &&
              refused.file === odd.file &&
              refused.reason === odd.reason
            : disagrees &&
              S.is(RunRootsDiffer)(refused) &&
              refused.first.projectRoot === root &&
              refused.other.projectRoot === odd.projectRoot &&
              refused.other.key.position === oddPosition,
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
        runAt(position, position === oddPosition ? readAt(root, { runInputsDigest, mutantIdsDigest }) : readAt(root))
      )
      const agreed = subject(AgreeRunRootsCommand.make({ runs }))
      return Result.isSuccess(agreed) && agreed.success.projectRoot === root
    },
  )
})
