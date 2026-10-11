import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  CandidatesKept,
  CandidatesUnderOtherRoots,
  CandidatesUnrecorded,
  dryRunCandidates,
  DryRunCandidatesCommand,
  type DryRunCandidatesDecision,
  NoCandidates,
} from '../dry-run-candidates.workflow.js'
import type { CoverageRoot } from '../dry-run-coverage.schema.js'

type Candidate = DryRunCandidatesCommand['candidates'][number]
type CandidatesResult = Result.Result<DryRunCandidatesDecision, never>

const recorded = (path: string): CoverageRoot => ({ _tag: 'RecordedRoot', path })

const UNRECORDED: CoverageRoot = { _tag: 'UnrecordedRoot' }

const otherRootOf = (command: DryRunCandidatesCommand, index: number): string =>
  `${command.currentRoot}-other-${index % 2}`

const withCandidates = (command: DryRunCandidatesCommand, candidates: readonly Candidate[]): DryRunCandidatesCommand =>
  DryRunCandidatesCommand.make({ currentRoot: command.currentRoot, candidates: [...candidates] })

const appended = (command: DryRunCandidatesCommand, candidate: Candidate): DryRunCandidatesCommand =>
  withCandidates(command, [...command.candidates, candidate])

const keptOf = (result: CandidatesResult): CandidatesKept | undefined =>
  Result.isSuccess(result) && S.is(CandidatesKept)(result.success) ? result.success : undefined

const keptIndicesOf = (result: CandidatesResult): readonly number[] => keptOf(result)?.indices ?? []

const keepsLast = (command: DryRunCandidatesCommand, result: CandidatesResult): boolean =>
  keptIndicesOf(result).includes(command.candidates.length - 1)

const increasing = (indices: readonly number[]): boolean =>
  indices.every((index, position) => position === 0 || (indices[position - 1] ?? index) < index)

describe('dryRunCandidates', () => {
  it.prop(
    '∀c_DryRunCandidatesCommand_≡ACandidateRecordedUnderTheCurrentRootIsKeptWhateverItsReportHeaderNames',
    { of: [DryRunCandidatesCommand], subject: dryRunCandidates },
    (subject, [command]) => {
      const target = appended(command, {
        recordRoot: recorded(command.currentRoot),
        headerRoot: recorded(otherRootOf(command, 0)),
      })
      return keepsLast(target, subject(target))
    },
  )

  it.prop(
    '∀c_DryRunCandidatesCommand_≡ACandidateRecordedUnderAnotherRootIsDroppedEvenWhenItsReportHeaderNamesTheCurrentRoot',
    { of: [DryRunCandidatesCommand], subject: dryRunCandidates },
    (subject, [command]) => {
      const target = appended(command, {
        recordRoot: recorded(otherRootOf(command, 0)),
        headerRoot: recorded(command.currentRoot),
      })
      return !keepsLast(target, subject(target))
    },
  )

  it.prop(
    '∀c_DryRunCandidatesCommand_≡ACandidateThatRecordsNoRootFallsBackToItsReportHeaderRoot',
    { of: [DryRunCandidatesCommand], subject: dryRunCandidates },
    (subject, [command]) => {
      const underHeader = appended(command, { recordRoot: UNRECORDED, headerRoot: recorded(command.currentRoot) })
      const nowhere = appended(command, { recordRoot: UNRECORDED, headerRoot: UNRECORDED })
      return keepsLast(underHeader, subject(underHeader)) && !keepsLast(nowhere, subject(nowhere))
    },
  )

  it.prop(
    '∀c_DryRunCandidatesCommand_≡KeptCandidatesComeInInputOrderAndKeptPlusDroppedCountsEveryCandidate',
    { of: [DryRunCandidatesCommand], subject: dryRunCandidates },
    (subject, [command]) => {
      const current = recorded(command.currentRoot)
      const target = withCandidates(
        command,
        command.candidates.map((candidate, index) =>
          index % 2 === 0 ? { ...candidate, recordRoot: current } : candidate
        ),
      )
      const result = subject(target)
      const kept = keptOf(result)
      const evens = target.candidates.flatMap((_candidate, index) => index % 2 === 0 ? [index] : [])
      return target.candidates.length === 0
        ? Result.isSuccess(result) && S.is(NoCandidates)(result.success)
        : kept !== undefined &&
          increasing(kept.indices) &&
          evens.every((index) => kept.indices.includes(index)) &&
          kept.indices.length + kept.droppedOtherRoot + kept.droppedUnrecorded === target.candidates.length
    },
  )

  it.prop(
    '∀c_DryRunCandidatesCommand_≡WithNoCandidateUnderTheCurrentRootTheRecordedRootsAreNamedSortedAndOnceEach',
    { of: [DryRunCandidatesCommand], subject: dryRunCandidates },
    (subject, [command]) => {
      const first = otherRootOf(command, 0)
      const second = otherRootOf(command, 1)
      const firstRoot = recorded(first)
      const secondRoot = recorded(second)
      const last = command.candidates.length - 1
      const target = withCandidates(
        command,
        command.candidates.map((candidate, index) => ({
          recordRoot: (last - index) % 2 === 0 ? firstRoot : secondRoot,
          headerRoot: candidate.headerRoot,
        })),
      )
      const result = subject(target)
      const named = last > 0 ? [first, second].sort() : [first]
      return target.candidates.length === 0
        ? Result.isSuccess(result) && S.is(NoCandidates)(result.success)
        : Result.isSuccess(result) && S.is(CandidatesUnderOtherRoots)(result.success) &&
          result.success.roots.join('\n') === named.join('\n')
    },
  )

  it.prop(
    '∀c_DryRunCandidatesCommand_≡CandidatesThatRecordNoRootAnywhereAreUnrecordedAndNoCandidatesAreNone',
    { of: [DryRunCandidatesCommand], subject: dryRunCandidates },
    (subject, [command]) => {
      const target = withCandidates(
        command,
        command.candidates.map(() => ({ recordRoot: UNRECORDED, headerRoot: UNRECORDED })),
      )
      const result = subject(target)
      return Result.isSuccess(result) &&
        (target.candidates.length === 0
          ? S.is(NoCandidates)(result.success)
          : S.is(CandidatesUnrecorded)(result.success))
    },
  )

  it.prop(
    '∀c_DryRunCandidatesCommand_≡AnOtherRootCandidateBeforeACurrentRootCandidateKeepsTheSecondAndCountsTheFirst',
    { of: [DryRunCandidatesCommand], subject: dryRunCandidates },
    (subject, [command]) => {
      const result = subject(withCandidates(command, [
        { recordRoot: recorded(otherRootOf(command, 0)), headerRoot: UNRECORDED },
        { recordRoot: recorded(command.currentRoot), headerRoot: UNRECORDED },
      ]))
      return Result.isSuccess(result) && S.is(CandidatesKept)(result.success) &&
        result.success.indices.join(',') === '1' &&
        result.success.droppedOtherRoot === 1 &&
        result.success.droppedUnrecorded === 0
    },
  )
})
