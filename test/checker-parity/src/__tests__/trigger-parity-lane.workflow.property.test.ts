import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type LaneTrigger,
  RunLane,
  SkipLane,
  triggerParityLane,
  TriggerParityLaneCommand,
} from '../trigger-parity-lane.workflow.js'

const LISTED_FILES = 20

const triggerOf = (
  subject: typeof triggerParityLane,
  closureDirectories: ReadonlyArray<string>,
  changedFiles: ReadonlyArray<string>,
  pushEvent = false,
): LaneTrigger =>
  Result.getOrThrow(
    subject(
      TriggerParityLaneCommand.make({
        pushEvent,
        closureDirectories: [...closureDirectories],
        changedFiles: [...changedFiles],
      }),
    ),
  )

const outsideFiles = (names: ReadonlyArray<string>): ReadonlyArray<string> => names.map((name) => `docs/${name}`)

describe('triggerParityLane', () => {
  it.prop(
    '∀e_PushEvent_≡Run',
    { of: [S.Array(S.String), S.Array(S.String)], subject: triggerParityLane },
    (subject, [closure, changed]) => {
      const trigger = triggerOf(subject, closure, changed, true)
      return S.is(RunLane)(trigger) && trigger.reason === 'push'
    },
  )

  it.prop(
    '∀f_FileInsideAClosurePackage_≡RunNamingIt',
    { of: [S.NonEmptyString, S.NonEmptyString, S.Array(S.String)], subject: triggerParityLane },
    (subject, [segment, name, others]) => {
      const file = `packages/${segment}/${name}`
      const trigger = triggerOf(subject, [`packages/${segment}`], [file, ...outsideFiles(others)])
      return S.is(RunLane)(trigger) && trigger.reason === 'closure-changed' && trigger.matched[0] === file
    },
  )

  it.prop(
    '∀s_SiblingPackageSharingAPrefix_≡Skip',
    { of: [S.NonEmptyString, S.NonEmptyString, S.Array(S.String)], subject: triggerParityLane },
    (subject, [segment, name, others]) => {
      const trigger = triggerOf(subject, [`packages/${segment}`], [
        `packages/${segment}x/${name}`,
        ...outsideFiles(others),
      ])
      return S.is(SkipLane)(trigger) && trigger.changedCount === others.length + 1
    },
  )

  it.prop(
    '∀d_LockfileChangeOutsideTheClosure_≡Run',
    { of: [S.Array(S.NonEmptyString), S.Array(S.String)], subject: triggerParityLane },
    (subject, [segments, others]) => {
      const trigger = triggerOf(
        subject,
        segments.map((segment) => `packages/${segment}`),
        [...outsideFiles(others), 'pnpm-lock.yaml'],
      )
      return S.is(RunLane)(trigger) && trigger.reason === 'shared-input-changed' &&
        trigger.matched.includes('pnpm-lock.yaml')
    },
  )

  it.prop(
    '∀n_ManyClosureFiles_≡CountedInFullListedUpToTwenty',
    { of: [S.NonEmptyArray(S.String)], subject: triggerParityLane },
    (subject, [names]) => {
      const trigger = triggerOf(subject, ['packages/checker'], names.map((name) => `packages/checker/${name}`))
      return S.is(RunLane)(trigger) && trigger.matchedCount === names.length &&
        trigger.matched.length === Math.min(names.length, LISTED_FILES)
    },
  )
})
