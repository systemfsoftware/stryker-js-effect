import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { DiffHunk, DiffScopeCommand, DiffScoped, DiffScopeDecision, FullScope } from '../git-diff.schema.js'
import { gitDiff } from '../git-diff.workflow.js'

type DiffSubject = (command: DiffScopeCommand) => Result.Result<DiffScopeDecision, never>

const decidedOf = (subject: DiffSubject, command: DiffScopeCommand): DiffScopeDecision | undefined =>
  Result.match(subject(command), { onFailure: () => undefined, onSuccess: (decision) => decision })

const decidedWith = (
  subject: DiffSubject,
  command: DiffScopeCommand,
  check: (decision: DiffScopeDecision) => boolean,
): boolean => {
  const decision = decidedOf(subject, command)
  return decision !== undefined && check(decision)
}

const segmentArb = Arbitrary.schema(S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,4}$/)))
const lineArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 500 })))

const changeHunk = (file: string, startLine: number, lineCount: number) => DiffHunk.make({ file, startLine, lineCount })

describe('gitDiff', () => {
  it.prop(
    '∀c_DiffScope_≡EveryRangeNamesAChangedFile',
    { of: [DiffScopeCommand], subject: gitDiff },
    (subject, [command]) => {
      const changed = [...command.hunks.map((hunk) => hunk.file), ...command.untrackedFiles]
      return decidedWith(subject, command, (decision) =>
        Match.value(decision).pipe(
          Match.tag('FullScope', () => true),
          Match.tag(
            'DiffScoped',
            (scoped) =>
              scoped.ranges.every(
                (range) => changed.some((file) => range === file || range.startsWith(`${file}:`)),
              ),
          ),
          Match.exhaustive,
        ))
    },
  )

  it.prop(
    '∀h_DiffScope_≡AChangedHunkBecomesItsLineRange',
    { of: [Arbitrary.all({ file: segmentArb, start: lineArb, count: lineArb })], subject: gitDiff },
    (subject, [draw]) => {
      const file = `src/${draw.file}.ts`
      const command = DiffScopeCommand.make({
        hunks: [changeHunk(file, draw.start, draw.count)],
        untrackedFiles: [],
      })
      const expected = `${file}:${draw.start}-${draw.start + draw.count - 1}`
      return decidedWith(
        subject,
        command,
        (decision) => S.is(DiffScoped)(decision) && decision.ranges.includes(expected),
      )
    },
  )

  it.prop(
    '∀h_DiffScope_≡ADeletedOnlyHunkProducesNoRange',
    { of: [Arbitrary.all({ file: segmentArb, start: lineArb })], subject: gitDiff },
    (subject, [draw]) => {
      const file = `src/${draw.file}.ts`
      const command = DiffScopeCommand.make({ hunks: [changeHunk(file, draw.start, 0)], untrackedFiles: [] })
      return decidedWith(
        subject,
        command,
        (decision) => S.is(DiffScoped)(decision) && !decision.ranges.some((range) => range.startsWith(`${file}:`)),
      )
    },
  )

  it.prop(
    '∀p_DiffScope_≡AConfigOrLockfileChangeFallsBackToFull',
    { of: [Arbitrary.all({ name: segmentArb })], subject: gitDiff },
    (subject, [draw]) => {
      const file = draw.name.length % 2 === 0 ? 'package.json' : 'pnpm-lock.yaml'
      const command = DiffScopeCommand.make({ hunks: [changeHunk(file, 1, 1)], untrackedFiles: [] })
      return decidedWith(subject, command, S.is(FullScope))
    },
  )

  it.prop(
    '∀p_DiffScope_≡AStrykerOrTestRunnerConfigChangeFallsBackToFull',
    { of: [Arbitrary.all({ name: segmentArb })], subject: gitDiff },
    (subject, [draw]) => {
      const file = draw.name.length % 2 === 0 ? 'stryker.config.js' : 'vitest.config.ts'
      const command = DiffScopeCommand.make({ hunks: [changeHunk(file, 1, 1)], untrackedFiles: [] })
      return decidedWith(subject, command, S.is(FullScope))
    },
  )

  it.prop(
    '∀f_DiffScope_≡AnUntrackedFileBecomesItsWholeFileRange',
    { of: [Arbitrary.all({ file: segmentArb })], subject: gitDiff },
    (subject, [draw]) => {
      const file = `src/${draw.file}.ts`
      const command = DiffScopeCommand.make({ hunks: [], untrackedFiles: [file] })
      return decidedWith(
        subject,
        command,
        (decision) => S.is(DiffScoped)(decision) && decision.ranges.includes(file),
      )
    },
  )
})
