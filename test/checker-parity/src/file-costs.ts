import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Num from 'effect/Number'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import {
  CheckCall,
  DigestCall,
  FileCosts,
  FileRate,
  type ParityLine,
  ProjectOverhead,
  type RunId,
  type Side,
} from './Parity.schema.js'

export const EMPTY_COSTS: FileCosts = FileCosts.make({ schemaVersion: 3, runs: [], files: [], projects: [] })

interface FileKey {
  readonly project: string
  readonly fileName: string
}

interface SideFileKey extends FileKey {
  readonly side: Side
}

interface SideProjectKey {
  readonly side: Side
  readonly project: string
}

interface FileTally {
  readonly side: Side
  readonly project: string
  readonly fileName: string
  readonly ms: number
  readonly mutants: number
}

interface DigestTally {
  readonly side: Side
  readonly project: string
  readonly ms: number
}

const fileKey = (file: FileKey): string => `${file.project.length}:${file.project}${file.fileName}`

const sideFileKey = (key: SideFileKey): string => `${key.side.length}:${key.side}${fileKey(key)}`

const sideProjectKey = (key: SideProjectKey): string =>
  `${key.side.length}:${key.side}${key.project.length}:${key.project}`

const fileRateOrder: Order.Order<FileRate> = Order.combine(
  Order.mapInput(Str.Order, (rate: FileRate) => rate.project),
  Order.mapInput(Str.Order, (rate: FileRate) => rate.fileName),
)

const overheadOrder: Order.Order<ProjectOverhead> = Order.mapInput(
  Str.Order,
  (overhead: ProjectOverhead) => overhead.project,
)

const isFreshCheck = (call: CheckCall): boolean => call.mutantIds.length > 0 && !call.cached

const isFreshCall = (line: ParityLine): line is CheckCall => S.is(CheckCall)(line) && isFreshCheck(line)

const isFreshDigest = (line: ParityLine): line is DigestCall => S.is(DigestCall)(line) && !line.cached

const talliesOf = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<FileTally> =>
  Object.values(
    Arr.groupBy(Arr.filter(lines, isFreshCall), (call) =>
      sideFileKey({ side: call.side, project: call.project, fileName: call.fileName })),
  ).map((calls) => ({
    side: calls[0].side,
    project: calls[0].project,
    fileName: calls[0].fileName,
    ms: calls.reduce((total, call) =>
      total + call.ms, 0),
    mutants: calls.reduce((total, call) => total + call.mutantIds.length, 0),
  }))

const slowerOrder: Order.Order<FileTally> = Order.combine(
  Order.mapInput(Order.Number, (tally: FileTally) => tally.ms / tally.mutants),
  Order.mapInput(Order.Number, (tally: FileTally) => tally.mutants),
)

const slowerSide = (sides: Arr.NonEmptyArray<FileTally>, runId: RunId): FileRate => {
  const winner = Arr.reduce(sides, sides[0], (best, side) => (slowerOrder(side, best) >= 0 ? side : best))
  return FileRate.make({
    project: winner.project,
    fileName: winner.fileName,
    msPerMutant: winner.ms / winner.mutants,
    mutants: winner.mutants,
    runId,
  })
}

const fileRatesOf = (lines: ReadonlyArray<ParityLine>, runId: RunId): ReadonlyArray<FileRate> =>
  Arr.sort(
    Object.values(Arr.groupBy(talliesOf(lines), fileKey)).map((sides) => slowerSide(sides, runId)),
    fileRateOrder,
  )

const digestTalliesOf = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<DigestTally> =>
  Object.values(
    Arr.groupBy(Arr.filter(lines, isFreshDigest), (digest) =>
      sideProjectKey({ side: digest.side, project: digest.project })),
  ).map((calls) => ({
    side: calls[0].side,
    project: calls[0].project,
    ms: calls.reduce((max, call) =>
      Num.max(max, call.ms), 0),
  }))

const overheadsOf = (lines: ReadonlyArray<ParityLine>, runId: RunId): ReadonlyArray<ProjectOverhead> =>
  Arr.sort(
    Object.values(Arr.groupBy(digestTalliesOf(lines), (tally) => tally.project)).map((sides) =>
      ProjectOverhead.make({
        project: sides[0].project,
        ms: sides.reduce((max, side) => Num.max(max, side.ms), 0),
        runId,
      })
    ),
    overheadOrder,
  )

export interface CostMeasurement {
  readonly files: ReadonlyArray<FileRate>
  readonly projects: ReadonlyArray<ProjectOverhead>
}

export const measuredCostsOf: {
  (runId: RunId): (lines: ReadonlyArray<ParityLine>) => CostMeasurement
  (lines: ReadonlyArray<ParityLine>, runId: RunId): CostMeasurement
} = dual(2, (lines: ReadonlyArray<ParityLine>, runId: RunId): CostMeasurement => ({
  files: fileRatesOf(lines, runId),
  projects: overheadsOf(lines, runId),
}))

export interface CostMerge {
  readonly base: FileCosts
  readonly measured: CostMeasurement
}

const newerOf = <A extends { readonly runId: RunId }>(earlier: A, later: A): A =>
  Boolean.match(later.runId >= earlier.runId, { onTrue: () => later, onFalse: () => earlier })

const newestByKey = <A extends { readonly runId: RunId }>(
  entries: ReadonlyArray<A>,
  keyOf: (entry: A) => string,
): ReadonlyArray<A> =>
  HashMap.toValues(
    entries.reduce(
      (kept, entry) =>
        HashMap.set(
          kept,
          keyOf(entry),
          Option.match(HashMap.get(kept, keyOf(entry)), {
            onNone: () => entry,
            onSome: (earlier) => newerOf(earlier, entry),
          }),
        ),
      HashMap.empty<string, A>(),
    ),
  )

export const mergeCosts = (merge: CostMerge): FileCosts =>
  FileCosts.make({
    schemaVersion: 3,
    runs: Arr.sort(
      Arr.dedupe([
        ...merge.base.runs,
        ...merge.measured.files.map((rate) => rate.runId),
        ...merge.measured.projects.map((overhead) => overhead.runId),
      ]),
      Order.Number,
    ),
    files: Arr.sort(newestByKey([...merge.base.files, ...merge.measured.files], fileKey), fileRateOrder),
    projects: Arr.sort(
      newestByKey([...merge.base.projects, ...merge.measured.projects], (overhead) => overhead.project),
      overheadOrder,
    ),
  })
