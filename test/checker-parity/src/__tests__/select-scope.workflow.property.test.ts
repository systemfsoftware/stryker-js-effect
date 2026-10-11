import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { ScopeSettings } from '../Parity.schema.js'
import {
  NothingSelected,
  type ScopeDecision,
  ScopeSelected,
  selectScope,
  SelectScopeCommand,
} from '../select-scope.workflow.js'

type Wire = Checker.CheckerMutantWire

const decisionOf = (subject: typeof selectScope, command: SelectScopeCommand): ScopeDecision =>
  Result.getOrThrow(subject(command))

const selectedOf = (decision: ScopeDecision): ScopeSelected =>
  S.is(ScopeSelected)(decision) ? decision : ScopeSelected.make({ changed: [], sampled: [], wires: [] })

const countsByFile = (wires: ReadonlyArray<Wire>): Readonly<Record<string, number>> =>
  wires.reduce<Record<string, number>>(
    (counts, wire) => ({ ...counts, [wire.fileName]: (counts[wire.fileName] ?? 0) + 1 }),
    {},
  )

const fileNamesOf = (wires: ReadonlyArray<Wire>): ReadonlyArray<Wire['fileName']> =>
  Arr.dedupe(wires.map((wire) => wire.fileName))

const crowdedOf = (wires: ReadonlyArray<Wire>, fileCount: number): ReadonlyArray<Wire> => {
  const files = Arr.take(fileNamesOf(wires), fileCount)
  return wires.map((wire, index) => ({ ...wire, fileName: files[index % files.length] ?? wire.fileName }))
}

const anchoredOf = (command: SelectScopeCommand, draw: number): SelectScopeCommand => {
  const spread = Math.abs(draw)
  const mutants = crowdedOf(command.mutants, 1 + (spread % 2))
  const files = fileNamesOf(mutants)
  return SelectScopeCommand.make({
    changedFiles: Arr.take(files, spread % (files.length + 1)),
    sampleFile: files.at(-1) ?? null,
    mutants: [...mutants],
    settings: ScopeSettings.make({
      schemaVersion: 1,
      seed: command.settings.seed,
      driftProjects: command.settings.driftProjects,
      perProject: 1 + (Math.trunc(spread / 2) % 4),
      perChangedFile: 1 + (Math.trunc(spread / 8) % 4),
    }),
  })
}

describe('selectScope', () => {
  it.prop(
    '∀c_ChangedFiles_≡EachCappedAtPerChangedFile',
    { of: [SelectScopeCommand, S.Int], subject: selectScope },
    (subject, [drawn, take]) => {
      const command = anchoredOf(drawn, take)
      const changed = countsByFile(selectedOf(decisionOf(subject, command)).changed)
      const available = countsByFile(command.mutants)
      const expected = Object.fromEntries(
        Arr.dedupe(command.changedFiles).map((file) => [
          file,
          Math.min(command.settings.perChangedFile, available[file] ?? 0),
        ]),
      )
      return Object.keys(changed).every((file) => changed[file] === expected[file]) &&
        Object.keys(expected).every((file) => (changed[file] ?? 0) === expected[file])
    },
  )

  it.prop(
    '∀s_SampleFile_≡OnlyItsMutantsCappedAtPerProject',
    { of: [SelectScopeCommand, S.Int], subject: selectScope },
    (subject, [drawn, take]) => {
      const command = anchoredOf(drawn, take)
      const sampled = selectedOf(decisionOf(subject, command)).sampled
      const pool = command.mutants.filter((wire) => wire.fileName === command.sampleFile)
      return sampled.every((wire) => wire.fileName === command.sampleFile) &&
        sampled.length === Math.min(command.settings.perProject, pool.length)
    },
  )

  it.prop(
    '∀k_SampleFile_≡EveryMutatorKindWhileTheCapAllows',
    { of: [SelectScopeCommand, S.Int], subject: selectScope },
    (subject, [drawn, take]) => {
      const command = anchoredOf(drawn, take)
      const sampledKinds = new Set(selectedOf(decisionOf(subject, command)).sampled.map((wire) => wire.mutatorName))
      const poolKinds = new Set(
        command.mutants.filter((wire) => wire.fileName === command.sampleFile).map((wire) => wire.mutatorName),
      )
      return sampledKinds.size === Math.min(poolKinds.size, command.settings.perProject)
    },
  )

  it.prop(
    '∀w_Wires_≡SortedDedupedUnionOrNothingSelected',
    { of: [SelectScopeCommand, S.Int], subject: selectScope },
    (subject, [drawn, take]) => {
      const command = anchoredOf(drawn, take)
      const decision = decisionOf(subject, command)
      const selected = selectedOf(decision)
      const union = Arr.sort(Arr.dedupe([...selected.changed, ...selected.sampled].map((wire) => wire.id)), Str.Order)
      const wireIds = selected.wires.map((wire) => wire.id)
      return union.length === 0
        ? S.is(NothingSelected)(decision)
        : wireIds.length === union.length && wireIds.every((id, index) => id === union[index])
    },
  )
})
