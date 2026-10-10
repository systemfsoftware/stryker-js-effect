import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  balanceFileShards,
  BalanceFileShardsCommand,
  type CorpusFile,
  FileShardsBalanced,
  type FileShardsDecision,
  NoCorpusFiles,
} from '../balance-file-shards.workflow.js'
import { FileCost } from '../Parity.schema.js'

const decisionOf = (subject: typeof balanceFileShards, command: BalanceFileShardsCommand): FileShardsDecision =>
  Result.getOrThrow(subject(command))

const balancedOf = (decision: FileShardsDecision): FileShardsBalanced =>
  S.is(FileShardsBalanced)(decision) ? decision : FileShardsBalanced.make({ files: [], loads: [] })

const keyOf = (file: { readonly project: string; readonly fileName: string }): string =>
  `${file.project}\u0000${file.fileName}`

const distinctFiles = (files: ReadonlyArray<CorpusFile>): ReadonlyArray<CorpusFile> =>
  Arr.dedupeWith(files, (left, right) => keyOf(left) === keyOf(right))

const withEvenFilesMeasured = (command: BalanceFileShardsCommand): BalanceFileShardsCommand =>
  BalanceFileShardsCommand.make({
    files: command.files,
    shards: command.shards,
    costs: distinctFiles(command.files).flatMap((file, index) =>
      index % 2 === 0 ? [FileCost.make({ project: file.project, fileName: file.fileName, ms: index * 7 + 3 })] : []
    ),
  })

describe('balanceFileShards', () => {
  it.prop(
    '∀a_EveryDistinctFile_≡OnExactlyOneShardWhoseLoadSumsItsFiles',
    { of: [BalanceFileShardsCommand], subject: balanceFileShards },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      const balanced = balancedOf(decision)
      const distinctKeys = distinctFiles(command.files).map(keyOf)
      const placed = new Set(balanced.files.map(keyOf))
      const sums = balanced.files.reduce<ReadonlyArray<number>>(
        (totals, file) => totals.map((total, index) => index === file.shard - 1 ? total + file.ms : total),
        Arr.replicate(0, command.shards),
      )
      const tolerance = 1e-6 * Math.max(1, ...balanced.loads)
      return S.is(NoCorpusFiles)(decision) === (distinctKeys.length === 0) &&
        balanced.files.length === distinctKeys.length &&
        distinctKeys.every((key) => placed.has(key)) &&
        balanced.files.every((file) => file.shard >= 1 && file.shard <= command.shards) &&
        (distinctKeys.length === 0 || balanced.loads.length === command.shards) &&
        balanced.loads.every((load, index) => Math.abs(load - (sums[index] ?? 0)) <= tolerance)
    },
  )

  it.prop(
    '∀b_Loads_≡DifferByAtMostTheHeaviestFile',
    { of: [BalanceFileShardsCommand], subject: balanceFileShards },
    (subject, [command]) => {
      const balanced = balancedOf(decisionOf(subject, withEvenFilesMeasured(command)))
      const heaviest = Math.max(0, ...balanced.files.map((file) => file.ms))
      return Math.max(0, ...balanced.loads) - Math.min(...balanced.loads, Math.max(0, ...balanced.loads)) <=
        heaviest + 1e-6
    },
  )

  it.prop(
    '∀o_InputOrder_≡SameAssignment',
    { of: [BalanceFileShardsCommand], subject: balanceFileShards },
    (subject, [command]) => {
      const measuredCommand = withEvenFilesMeasured(command)
      const reversed = BalanceFileShardsCommand.make({
        files: Arr.reverse(measuredCommand.files),
        costs: Arr.reverse(measuredCommand.costs),
        shards: measuredCommand.shards,
      })
      const first = balancedOf(decisionOf(subject, measuredCommand)).files
      const again = balancedOf(decisionOf(subject, reversed)).files
      return first.length === again.length &&
        Arr.every(Arr.zip(first, again), ([left, right]) => keyOf(left) === keyOf(right) && left.shard === right.shard)
    },
  )
})
