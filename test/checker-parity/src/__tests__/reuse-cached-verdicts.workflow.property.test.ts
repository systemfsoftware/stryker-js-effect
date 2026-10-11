import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  CheckFreshly,
  type FreshReason,
  reuseCachedVerdicts,
  ReuseCachedVerdictsCommand,
  VerdictCacheIdentity,
  type VerdictReuse,
  VerdictsReused,
} from '../reuse-cached-verdicts.workflow.js'

const decisionOf = (
  subject: typeof reuseCachedVerdicts,
  current: VerdictCacheIdentity,
  stored: VerdictCacheIdentity | null,
): VerdictReuse => Result.getOrThrow(subject(ReuseCachedVerdictsCommand.make({ current, stored })))

const freshBecause = (decision: VerdictReuse, reason: FreshReason): boolean =>
  S.is(CheckFreshly)(decision) && decision.reason === reason

interface IdentityFields {
  readonly bundleHash: string
  readonly programDigest: string
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
}

const identityOf = (fields: IdentityFields): VerdictCacheIdentity =>
  VerdictCacheIdentity.make({
    schemaVersion: 1,
    bundleHash: fields.bundleHash,
    programDigest: fields.programDigest,
    wires: [...fields.wires],
  })

const withWires = (identity: VerdictCacheIdentity, wires: ReadonlyArray<Checker.CheckerMutantWire>) =>
  identityOf({ bundleHash: identity.bundleHash, programDigest: identity.programDigest, wires })

describe('reuseCachedVerdicts', () => {
  it.prop(
    '∀w_StoredIdenticalInAnyWireOrderOrAbsent_≡ReusedOrNoCachedVerdicts',
    { of: [VerdictCacheIdentity], subject: reuseCachedVerdicts },
    (subject, [identity]) =>
      S.is(VerdictsReused)(decisionOf(subject, identity, withWires(identity, Arr.reverse(identity.wires)))) &&
      freshBecause(decisionOf(subject, identity, null), 'no-cached-verdicts'),
  )

  it.prop(
    '∀b_OtherBundle_≡BundleChanged',
    { of: [VerdictCacheIdentity, S.String], subject: reuseCachedVerdicts },
    (subject, [identity, suffix]) =>
      freshBecause(
        decisionOf(
          subject,
          identity,
          identityOf({
            bundleHash: `${identity.bundleHash}~${suffix}`,
            programDigest: identity.programDigest,
            wires: identity.wires,
          }),
        ),
        'bundle-changed',
      ),
  )

  it.prop(
    '∀p_OtherProgram_≡ProgramChanged',
    { of: [VerdictCacheIdentity, S.String], subject: reuseCachedVerdicts },
    (subject, [identity, suffix]) =>
      freshBecause(
        decisionOf(
          subject,
          identity,
          identityOf({
            bundleHash: identity.bundleHash,
            programDigest: `${identity.programDigest}~${suffix}`,
            wires: identity.wires,
          }),
        ),
        'program-changed',
      ),
  )

  it.prop(
    '∀r_OtherReplacement_≡MutantsChanged',
    { of: [VerdictCacheIdentity, Checker.CheckerMutantWire], subject: reuseCachedVerdicts },
    (subject, [identity, wire]) =>
      freshBecause(
        decisionOf(
          subject,
          withWires(identity, [...identity.wires, wire]),
          withWires(identity, [...identity.wires, { ...wire, replacement: `${wire.replacement}~` }]),
        ),
        'mutants-changed',
      ),
  )
})
