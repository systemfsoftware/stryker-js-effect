import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as HashMap from 'effect/HashMap'
import * as Num from 'effect/Number'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { FileCost } from './Parity.schema.js'

const BalanceFileShardsTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-checker-parity/BalanceFileShards',
)
type BalanceFileShardsTypeId = typeof BalanceFileShardsTypeId

const PositiveInt = S.Int.check(S.isGreaterThanOrEqualTo(1))
const NonNegativeFinite = S.Finite.check(S.isGreaterThanOrEqualTo(0))

const UNMEASURED_CORPUS_MS = 1

export class CorpusFile extends S.Class<CorpusFile>('CorpusFile')({
  project: S.String,
  fileName: S.String,
}) {}

export class BalanceFileShardsCommand extends S.TaggedClass<BalanceFileShardsCommand>()('BalanceFileShardsCommand', {
  files: S.Array(CorpusFile),
  costs: S.Array(FileCost),
  shards: PositiveInt,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export const CostSource = S.Literals(['measured', 'project-mean', 'corpus-median', 'no-measurements'])
export type CostSource = typeof CostSource.Type

export class FileShard extends S.Class<FileShard>('FileShard')({
  project: S.String,
  fileName: S.String,
  shard: PositiveInt,
  ms: NonNegativeFinite,
  source: CostSource,
}) {}

export class FileShardsBalanced extends S.TaggedClass<FileShardsBalanced>()('FileShardsBalanced', {
  files: S.Array(FileShard),
  loads: S.Array(NonNegativeFinite),
}) {
  readonly [BalanceFileShardsTypeId] = BalanceFileShardsTypeId
}

export class NoCorpusFiles extends S.TaggedClass<NoCorpusFiles>()('NoCorpusFiles', {}) {
  readonly [BalanceFileShardsTypeId] = BalanceFileShardsTypeId
}

export const FileShardsDecision = S.Union([FileShardsBalanced, NoCorpusFiles])
export type FileShardsDecision = typeof FileShardsDecision.Type

interface FileKey {
  readonly project: string
  readonly fileName: string
}

const keyOf = (file: FileKey): string => `${file.project}\u0000${file.fileName}`

const fileOrder: Order.Order<FileKey> = Order.combine(
  Order.mapInput(Str.Order, (file: FileKey) => file.project),
  Order.mapInput(Str.Order, (file: FileKey) => file.fileName),
)

interface Estimate {
  readonly ms: number
  readonly source: CostSource
}

const measuredOf = (costs: ReadonlyArray<FileCost>): HashMap.HashMap<string, number> =>
  costs.reduce(
    (measured, cost) =>
      HashMap.set(
        measured,
        keyOf(cost),
        Num.max(cost.ms, Option.getOrElse(HashMap.get(measured, keyOf(cost)), () => 0)),
      ),
    HashMap.empty<string, number>(),
  )

const lowerMedianOf = (values: ReadonlyArray<number>): Option.Option<number> =>
  Arr.get(Arr.sort(values, Num.Order), (values.length - 1) >> 1)

const projectMeansOf = (costs: ReadonlyArray<FileCost>): HashMap.HashMap<string, number> =>
  HashMap.fromIterable(
    Object.entries(Arr.groupBy(costs, (cost) => cost.project)).map(([project, owned]) =>
      [project, owned.reduce((total, cost) => total + cost.ms, 0) / owned.length] as const
    ),
  )

const estimatorOf = (costs: ReadonlyArray<FileCost>) => {
  const measured = measuredOf(costs)
  const projectMeans = projectMeansOf(costs)
  const corpusMedian = measured.pipe(HashMap.toValues, lowerMedianOf)
  return (file: CorpusFile): Estimate =>
    Option.match(HashMap.get(measured, keyOf(file)), {
      onSome: (ms): Estimate => ({ ms, source: 'measured' }),
      onNone: () =>
        Option.match(HashMap.get(projectMeans, file.project), {
          onSome: (ms): Estimate => ({ ms, source: 'project-mean' }),
          onNone: () =>
            Option.match(corpusMedian, {
              onSome: (ms): Estimate => ({ ms, source: 'corpus-median' }),
              onNone: (): Estimate => ({ ms: UNMEASURED_CORPUS_MS, source: 'no-measurements' }),
            }),
        }),
    })
}

interface Placement {
  readonly loads: ReadonlyArray<number>
  readonly files: ReadonlyArray<FileShard>
}

const leastLoadedOf = (loads: ReadonlyArray<number>): number =>
  loads.indexOf(loads.reduce(Num.min, Number.POSITIVE_INFINITY))

const place = (placement: Placement, [file, estimate]: readonly [CorpusFile, Estimate]): Placement => {
  const index = leastLoadedOf(placement.loads)
  return {
    loads: placement.loads.map((load, shard) => load + estimate.ms * Number(shard === index)),
    files: [
      ...placement.files,
      FileShard.make({
        project: file.project,
        fileName: file.fileName,
        shard: index + 1,
        ms: estimate.ms,
        source: estimate.source,
      }),
    ],
  }
}

const heaviestFirst: Order.Order<readonly [CorpusFile, Estimate]> = Order.combine(
  Order.mapInput(Order.flip(Num.Order), ([, estimate]: readonly [CorpusFile, Estimate]) => estimate.ms),
  Order.mapInput(fileOrder, ([file]: readonly [CorpusFile, Estimate]) => file),
)

const balanceOf = (command: BalanceFileShardsCommand, files: ReadonlyArray<CorpusFile>): FileShardsBalanced => {
  const estimate = estimatorOf(command.costs)
  const placed = Arr.sort(files.map((file) => [file, estimate(file)] as const), heaviestFirst).reduce(
    place,
    { loads: Arr.replicate(0, command.shards), files: [] },
  )
  return FileShardsBalanced.make({ files: Arr.sort(placed.files, fileOrder), loads: placed.loads })
}

const decide = (command: BalanceFileShardsCommand): Result.Result<FileShardsDecision, never> =>
  Result.succeed(
    Arr.match(Arr.dedupeWith(command.files, (left, right) => keyOf(left) === keyOf(right)), {
      onEmpty: (): FileShardsDecision => NoCorpusFiles.make({}),
      onNonEmpty: (files): FileShardsDecision => balanceOf(command, files),
    }),
  )

export const balanceFileShards = Workflow.make({
  command: BalanceFileShardsCommand,
  decision: FileShardsDecision,
  error: S.Never,
  decide,
})
