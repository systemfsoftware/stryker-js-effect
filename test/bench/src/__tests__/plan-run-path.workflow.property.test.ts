import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { planRunPath, PlanRunPathCommand } from '../plan-run-path.workflow.js'
import { RunPathMoveIn, RunPathOccupied, RunPathOutsideTree } from '../run-path.schema.js'

const segmentsArb = Arbitrary.array(Arbitrary.schema(S.Literals(['a', 'b', 'bench-a', 'bench-b', 'pkg', 'src'])), {
  minLength: 1,
  maxLength: 4,
})

const tailArb = Arbitrary.array(Arbitrary.schema(S.Literals(['a', 'b', 'pkg', 'src'])), { maxLength: 3 })
const entriesArb = Arbitrary.array(Arbitrary.schema(S.Literals(['bench-a', 'bench-b', 'bench-runs', 'bench-work'])), {
  maxLength: 4,
})

const absolute = (segments: ReadonlyArray<string>): string => `/${segments.join('/')}`

const relative = (segments: ReadonlyArray<string>): string => segments.length === 0 ? '' : `/${segments.join('/')}`

describe('planRunPath', () => {
  it.prop(
    '∀rpi_TwoSidesWithTheSameLayoutUnderDifferentHomes_≡IdenticalRunPathCwdAndCli',
    { of: [segmentsArb, segmentsArb, segmentsArb, tailArb, tailArb, entriesArb], subject: planRunPath },
    (subject, [temp, homeA, homeB, cwdTail, cliTail, entries]) => {
      const runnerTemp = absolute(temp)
      const planOf = (side: 'A' | 'B', home: ReadonlyArray<string>) => {
        const tree = `${runnerTemp}/${home.join('-')}-${side}`
        return Result.getOrThrow(subject(PlanRunPathCommand.make({
          runnerTemp,
          runnerTempEntries: [...entries],
          side,
          tree,
          cwd: `${tree}${relative(cwdTail)}`,
          cli: `${tree}${relative(cliTail)}`,
        })))
      }
      const a = planOf('A', homeA)
      const b = planOf('B', homeB)
      return S.is(RunPathMoveIn)(a) && S.is(RunPathMoveIn)(b) &&
        a.runPath === `${runnerTemp}/bench-run` &&
        a.runPath === b.runPath &&
        a.cwd === b.cwd &&
        a.cli === b.cli &&
        a.cwd === `${a.runPath}${relative(cwdTail)}` &&
        a.cli === `${a.runPath}${relative(cliTail)}`
    },
  )

  it.prop(
    '∀rpo_RunPathAlreadyPresentInRunnerTemp_≡OccupiedNamingTheSideAndPath',
    { of: [segmentsArb, segmentsArb, entriesArb, S.Literals(['A', 'B'])], subject: planRunPath },
    (subject, [temp, home, entries, side]) => {
      const runnerTemp = absolute(temp)
      const tree = `${runnerTemp}${absolute(home)}`
      const plan = Result.getOrThrow(subject(PlanRunPathCommand.make({
        runnerTemp,
        runnerTempEntries: [...entries, 'bench-run'],
        side,
        tree,
        cwd: tree,
        cli: tree,
      })))
      return S.is(RunPathOccupied)(plan) && plan.side === side && plan.runPath === `${runnerTemp}/bench-run`
    },
  )

  it.prop(
    '∀rpx_CwdOrCliOutsideTheTree_≡RunPathOutsideTreeNamingThatPath',
    { of: [segmentsArb, segmentsArb, segmentsArb, S.Boolean], subject: planRunPath },
    (subject, [temp, home, elsewhere, cwdOutside]) => {
      const runnerTemp = absolute(temp)
      const tree = `${runnerTemp}/tree`
      const outside = `${tree}-sibling${absolute(elsewhere)}`
      const inside = `${tree}${absolute(home)}`
      const result = subject(PlanRunPathCommand.make({
        runnerTemp,
        runnerTempEntries: [],
        side: 'A',
        tree,
        cwd: cwdOutside ? outside : inside,
        cli: cwdOutside ? inside : outside,
      }))
      return Result.isFailure(result) && S.is(RunPathOutsideTree)(result.failure) && result.failure.path === outside
    },
  )
})
