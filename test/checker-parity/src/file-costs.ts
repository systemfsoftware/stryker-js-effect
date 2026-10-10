import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Num from 'effect/Number'
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
  type Side,
} from './Parity.schema.js'

export const EMPTY_COSTS: FileCosts = FileCosts.make({ schemaVersion: 2, runs: [], files: [], projects: [] })

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

const slowerSide = (sides: Arr.NonEmptyArray<FileTally>): FileRate => {
  const winner = Arr.reduce(sides, sides[0], (best, side) => (slowerOrder(side, best) >= 0 ? side : best))
  return FileRate.make({
    project: winner.project,
    fileName: winner.fileName,
    msPerMutant: winner.ms / winner.mutants,
    mutants: winner.mutants,
  })
}

const fileRatesOf = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<FileRate> =>
  Arr.sort(
    Object.values(Arr.groupBy(talliesOf(lines), fileKey)).map((sides) => slowerSide(sides)),
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

const overheadsOf = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<ProjectOverhead> =>
  Arr.sort(
    Object.values(Arr.groupBy(digestTalliesOf(lines), (tally) => tally.project)).map((sides) =>
      ProjectOverhead.make({
        project: sides[0].project,
        ms: sides.reduce((max, side) => Num.max(max, side.ms), 0),
      })
    ),
    overheadOrder,
  )

export interface CostMeasurement {
  readonly files: ReadonlyArray<FileRate>
  readonly projects: ReadonlyArray<ProjectOverhead>
}

export const measuredCostsOf = (lines: ReadonlyArray<ParityLine>): CostMeasurement => ({
  files: fileRatesOf(lines),
  projects: overheadsOf(lines),
})

export interface CostMerge {
  readonly base: FileCosts
  readonly measured: CostMeasurement
  readonly runId: string
}

const runsOf = (anything: boolean, base: ReadonlyArray<string>, runId: string): ReadonlyArray<string> =>
  Boolean.match(anything, { onTrue: () => Arr.dedupe([...base, runId]), onFalse: () => base })

const hasMeasured = (measured: CostMeasurement): boolean =>
  Arr.match(measured.files, { onEmpty: () => false, onNonEmpty: () => true }) ||
  Arr.match(measured.projects, { onEmpty: () => false, onNonEmpty: () => true })

export const mergeCosts = (merge: CostMerge): FileCosts => {
  const measuredFileKeys = new Set(merge.measured.files.map(fileKey))
  const measuredProjectKeys = new Set(merge.measured.projects.map((overhead) => overhead.project))
  return FileCosts.make({
    schemaVersion: 2,
    runs: runsOf(hasMeasured(merge.measured), merge.base.runs, merge.runId),
    files: Arr.sort(
      [...merge.base.files.filter((rate) => !measuredFileKeys.has(fileKey(rate))), ...merge.measured.files],
      fileRateOrder,
    ),
    projects: Arr.sort(
      [
        ...merge.base.projects.filter((overhead) => !measuredProjectKeys.has(overhead.project)),
        ...merge.measured.projects,
      ],
      overheadOrder,
    ),
  })
}
