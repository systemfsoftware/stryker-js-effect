import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'

import {
  capSurvivors,
  CapSurvivorsCommand,
  type CapSurvivorsDecision,
  type SurfacingCaps,
  SurvivorRef,
} from '../cap-survivors.workflow.js'

const partsOf = (
  decision: CapSurvivorsDecision,
): { readonly surfaced: ReadonlyArray<SurvivorRef>; readonly capped: ReadonlyArray<SurvivorRef> } =>
  Match.value(decision).pipe(
    Match.tag('SurvivorsWithinCaps', (within) => ({ surfaced: within.surfaced, capped: [] })),
    Match.tag('SurvivorsCapped', (capped) => ({ surfaced: capped.surfaced, capped: capped.capped })),
    Match.exhaustive,
  )

const lineKeyOf = (survivor: SurvivorRef): string => `${survivor.fileName}\u0000${survivor.line}`
const fileKeyOf = (survivor: SurvivorRef): string => survivor.fileName

const withinCaps = (surfaced: ReadonlyArray<SurvivorRef>, caps: SurfacingCaps): boolean =>
  Arr.every(Object.values(Arr.groupBy(surfaced, lineKeyOf)), (group) => group.length <= caps.perLine) &&
  Arr.every(Object.values(Arr.groupBy(surfaced, fileKeyOf)), (group) => group.length <= caps.perFile)

const sortedIdsOf = (survivors: ReadonlyArray<SurvivorRef>): ReadonlyArray<string> =>
  Arr.sort(
    Arr.map(survivors, (survivor) => survivor.id),
    Order.String,
  )

const idTextOf = (survivors: ReadonlyArray<SurvivorRef>): string => Arr.join(sortedIdsOf(survivors), ',')

describe('capSurvivors', () => {
  it.prop(
    '∀c_CapSurvivorsCommand_≡SurfacedWithinCapsAndNoVerdictDropped',
    { of: [CapSurvivorsCommand], subject: capSurvivors },
    (subject, [command]) => {
      const parts = partsOf(subject(command).pipe(Result.getOrThrow))
      const kept = Arr.appendAll(parts.surfaced, parts.capped)
      const keptIds = Arr.dedupe(sortedIdsOf(kept))
      return (
        withinCaps(parts.surfaced, command.caps) &&
        Arr.length(kept) === Arr.length(keptIds) &&
        Arr.every(kept, (survivor) => Arr.contains(keptIds, survivor.id)) &&
        Arr.length(keptIds) === Arr.length(Arr.dedupe(sortedIdsOf(command.survivors)))
      )
    },
  )

  it.prop(
    '∀c_CapSurvivorsCommand_≡SelectionIsIndependentOfInputOrder',
    { of: [CapSurvivorsCommand], subject: capSurvivors },
    (subject, [command]) => {
      const reversed = CapSurvivorsCommand.make({ caps: command.caps, survivors: Arr.reverse(command.survivors) })
      const left = partsOf(subject(command).pipe(Result.getOrThrow))
      const right = partsOf(subject(reversed).pipe(Result.getOrThrow))
      return idTextOf(left.surfaced) === idTextOf(right.surfaced) && idTextOf(left.capped) === idTextOf(right.capped)
    },
  )

  it.prop(
    '∀c_CapSurvivorsCommand_≡SurvivorsSharingALineSurfaceToTheTightestCap',
    { of: [CapSurvivorsCommand], subject: capSurvivors },
    (subject, [command]) => {
      const collapsed = CapSurvivorsCommand.make({
        survivors: Arr.map(
          command.survivors,
          (survivor) => SurvivorRef.make({ id: survivor.id, fileName: 'src/collapsed.js', line: 1 }),
        ),
        caps: command.caps,
      })
      const parts = partsOf(subject(collapsed).pipe(Result.getOrThrow))
      const distinct = Arr.length(Arr.dedupe(sortedIdsOf(collapsed.survivors)))
      const expected = Math.min(distinct, collapsed.caps.perLine, collapsed.caps.perFile)
      return (
        Arr.length(parts.surfaced) === expected &&
        Arr.length(parts.capped) === distinct - expected &&
        Arr.length(Arr.dedupe(sortedIdsOf(parts.surfaced))) === Arr.length(parts.surfaced)
      )
    },
  )
})
