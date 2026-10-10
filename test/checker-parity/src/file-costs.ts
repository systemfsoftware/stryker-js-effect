import * as Arr from 'effect/Array'
import * as Num from 'effect/Number'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import {
  CacheEntry,
  CheckCall,
  Deferred,
  FileCost,
  FileCosts,
  type ParityLine,
  type Side,
  UnitOverBudget,
} from './Parity.schema.js'

interface SideFile {
  readonly side: Side
  readonly project: string
  readonly fileName: string
}

interface ProjectFile {
  readonly project: string
  readonly fileName: string
}

const isCheckCall = S.is(CheckCall)
const isCacheHit = (line: ParityLine): line is CacheEntry => S.is(CacheEntry)(line) && line.hit
const isOverBudget = S.is(UnitOverBudget)
const isDeferred = S.is(Deferred)

const deferredFileKeyOf = (line: Deferred): Option.Option<string> =>
  Option.map(
    Option.all({ side: Option.fromNullishOr(line.side), fileName: Option.fromNullishOr(line.fileName) }),
    ({ side, fileName }) => sideKeyOf({ side, project: line.project, fileName }),
  )

const sideKeyOf = (line: SideFile): string => `${line.side}\u0000${line.project}\u0000${line.fileName}`

const fileKeyOf = (file: ProjectFile): string => `${file.project}\u0000${file.fileName}`

const costOrder: Order.Order<FileCost> = Order.combine(
  Order.mapInput(Str.Order, (cost: FileCost) => cost.project),
  Order.mapInput(Str.Order, (cost: FileCost) => cost.fileName),
)

const unmeasuredKeysOf = (lines: ReadonlyArray<ParityLine>): ReadonlySet<string> =>
  new Set([
    ...lines.filter(isCacheHit).map(sideKeyOf),
    ...lines.filter(isDeferred).flatMap((line) => Option.toArray(deferredFileKeyOf(line))),
    ...lines.filter(isOverBudget).map(sideKeyOf),
  ])

const freshCallsOf = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<CheckCall> => {
  const unmeasured = unmeasuredKeysOf(lines)
  return lines.filter(isCheckCall).filter((call) => !call.cached && !unmeasured.has(sideKeyOf(call)))
}

const summedCost = (calls: Arr.NonEmptyReadonlyArray<CheckCall>): FileCost =>
  FileCost.make({
    project: calls[0].project,
    fileName: calls[0].fileName,
    ms: calls.reduce((total, call) => total + call.ms, 0),
  })

const slowerSide = (sides: Arr.NonEmptyReadonlyArray<FileCost>): FileCost =>
  FileCost.make({
    project: sides[0].project,
    fileName: sides[0].fileName,
    ms: sides.reduce((slowest, side) => Num.max(slowest, side.ms), 0),
  })

export const measuredCostsOf = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<FileCost> => {
  const perSide = Object.values(Arr.groupBy(freshCallsOf(lines), sideKeyOf)).map(summedCost)
  return Arr.sort(Object.values(Arr.groupBy(perSide, fileKeyOf)).map(slowerSide), costOrder)
}

export interface CostMerge {
  readonly base: FileCosts
  readonly measured: ReadonlyArray<FileCost>
  readonly runId: string
}

export const mergeCosts = (merge: CostMerge): FileCosts => {
  const measuredKeys = new Set(merge.measured.map(fileKeyOf))
  return FileCosts.make({
    schemaVersion: 1,
    runs: Arr.dedupe([...merge.base.runs, ...Arr.isReadonlyArrayNonEmpty(merge.measured) ? [merge.runId] : []]),
    files: Arr.sort(
      [...merge.base.files.filter((cost) => !measuredKeys.has(fileKeyOf(cost))), ...merge.measured],
      costOrder,
    ),
  })
}
