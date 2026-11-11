import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CheckCall, ParityLine, PhaseLine, type Side } from './Parity.schema.js'

const SCHEMA_VERSION = S.Literal(1)

export class SlowerThanMain
  extends S.TaggedClass<SlowerThanMain, { readonly brand: unique symbol }>()('SlowerThanMain', {
    schemaVersion: SCHEMA_VERSION,
    code: S.Literal('slower-than-main'),
    nextAction: S.String,
    branchMs: S.Finite,
    mainMs: S.Finite,
  })
{}

const SpeedGateTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/SpeedGate')
type SpeedGateTypeId = typeof SpeedGateTypeId

export class SpeedGateUnmeasured
  extends S.TaggedClass<SpeedGateUnmeasured, { readonly brand: unique symbol }>()('SpeedGateUnmeasured', {
    schemaVersion: SCHEMA_VERSION,
    code: S.Literal('speed-gate-unmeasured'),
    nextAction: S.String,
  })
{
  readonly [SpeedGateTypeId] = SpeedGateTypeId
}

export type Warning = SpeedGateUnmeasured

export class SpeedGateCommand
  extends S.TaggedClass<SpeedGateCommand, { readonly brand: unique symbol }>()('SpeedGateCommand', {
    lines: S.Array(ParityLine),
    projects: S.Array(S.String),
    speedGateEnabled: S.Boolean,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class SpeedGateEvaluated
  extends S.TaggedClass<SpeedGateEvaluated, { readonly brand: unique symbol }>()('SpeedGateEvaluated', {
    measuredProjects: S.Array(S.String),
    mainMs: S.Finite,
    branchMs: S.Finite,
    slowerThanMain: S.Array(SlowerThanMain),
  })
{
  readonly [SpeedGateTypeId] = SpeedGateTypeId
}

export const SpeedGateDecision = S.Union([SpeedGateEvaluated, SpeedGateUnmeasured])
export type SpeedGateDecision = typeof SpeedGateDecision.Type

const when = <A>(condition: boolean, value: A): ReadonlyArray<A> =>
  Boolean.match(condition, { onTrue: (): ReadonlyArray<A> => [value], onFalse: (): ReadonlyArray<A> => [] })

const isPhaseLine = S.is(PhaseLine)
const isCheckCall = S.is(CheckCall)

const phaseLinesIn = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<PhaseLine> =>
  lines.filter((line): line is PhaseLine => isPhaseLine(line))

const phaseLinesOf = (
  lines: ReadonlyArray<ParityLine>,
  project: string,
  side: Side,
): ReadonlyArray<PhaseLine> =>
  phaseLinesIn(lines).filter((line) => Boolean.every([line.project === project, line.side === side, !line.cached]))

const phaseMsOf = (lines: ReadonlyArray<ParityLine>, project: string, side: Side): number =>
  phaseLinesOf(lines, project, side).reduce((total, line) => total + line.ms, 0)

const checkCallsIn = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<CheckCall> =>
  lines.filter((line): line is CheckCall => isCheckCall(line))

const nonCachedCheckCalls = (lines: ReadonlyArray<ParityLine>, project: string, side: Side): number =>
  checkCallsIn(lines).filter((call) => Boolean.every([call.project === project, call.side === side, !call.cached]))
    .length

const checkedOnBoth = (lines: ReadonlyArray<ParityLine>, projects: ReadonlyArray<string>): ReadonlyArray<string> =>
  projects.filter((project) =>
    Boolean.every([
      nonCachedCheckCalls(lines, project, 'main') > 0,
      nonCachedCheckCalls(lines, project, 'branch') > 0,
    ])
  )

const speedSum = (
  lines: ReadonlyArray<ParityLine>,
  projects: ReadonlyArray<string>,
  side: Side,
): number => projects.reduce((total, project) => total + phaseMsOf(lines, project, side), 0)

const slowerThanMainOf = (command: SpeedGateCommand, measuredProjects: ReadonlyArray<string>): ReadonlyArray<
  SlowerThanMain
> => {
  const mainMs = speedSum(command.lines, measuredProjects, 'main')
  const branchMs = speedSum(command.lines, measuredProjects, 'branch')
  return when(
    Boolean.every([command.speedGateEnabled, measuredProjects.length > 0, branchMs >= mainMs]),
    SlowerThanMain.make({
      schemaVersion: 1,
      code: 'slower-than-main',
      nextAction:
        `Compare the phase lines for projects that ran a fresh check on both sides in the shard NDJSON: branch ${branchMs} ms is not strictly below main ${mainMs} ms. Profile the branch checker's check phase.`,
      branchMs,
      mainMs,
    }),
  )
}

const evaluatedOf = (command: SpeedGateCommand): SpeedGateDecision => {
  const measuredProjects = checkedOnBoth(command.lines, command.projects)
  return Boolean.match(
    Boolean.every([command.speedGateEnabled, measuredProjects.length === 0]),
    {
      onTrue: () =>
        SpeedGateUnmeasured.make({
          schemaVersion: 1,
          code: 'speed-gate-unmeasured',
          nextAction:
            `No project ran a fresh (non-cached) check on both sides, so the speed gate compared nothing. Rerun with a corpus change or a cold verdict cache so at least one project checks fresh on both sides.`,
        }),
      onFalse: () =>
        SpeedGateEvaluated.make({
          measuredProjects,
          mainMs: speedSum(command.lines, measuredProjects, 'main'),
          branchMs: speedSum(command.lines, measuredProjects, 'branch'),
          slowerThanMain: slowerThanMainOf(command, measuredProjects),
        }),
    },
  )
}

export const speedGate = Workflow.make({
  command: SpeedGateCommand,
  decision: SpeedGateDecision,
  error: S.Never,
  decide: (command: SpeedGateCommand): Result.Result<SpeedGateDecision, never> => Result.succeed(evaluatedOf(command)),
})
