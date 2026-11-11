import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CheckCall, DigestCall, GroupCall, ParityLine, type Side } from '../Parity.schema.js'
import {
  SlowerThanMain,
  speedGate,
  SpeedGateCommand,
  type SpeedGateDecision,
  SpeedGateUnmeasured,
} from '../speed-gate.workflow.js'

const PROJECT = 'packages/example/tsconfig.app.json'
const OTHER_PROJECT = 'packages/other/tsconfig.app.json'
const FILE = 'packages/example/src/a.ts'

const digitsOf = (draw: number): number => Math.abs(draw)

const checkCallOf = (
  side: Side,
  project: string,
  callIndex: number,
  mutantIds: ReadonlyArray<string>,
  ms: number,
  cached = false,
): CheckCall => CheckCall.make({ schemaVersion: 1, side, project, fileName: FILE, callIndex, mutantIds, ms, cached })

type PhaseKind = 'fresh-check' | 'group' | 'digest' | 'cached-check'

const phaseLineOf = (side: Side, project: string, kind: PhaseKind, ms: number): ParityLine => {
  const builders: Record<PhaseKind, () => ParityLine> = {
    'fresh-check': () => checkCallOf(side, project, 0, [], ms),
    group: () => GroupCall.make({ schemaVersion: 1, side, project, ms, groups: 1, cached: false }),
    digest: () => DigestCall.make({ schemaVersion: 1, side, project, ms, digest: 'digest', cached: false }),
    'cached-check': () => checkCallOf(side, project, 0, [], ms, true),
  }
  return builders[kind]()
}

const commandOf = (
  lines: ReadonlyArray<ParityLine>,
  projects: ReadonlyArray<string>,
  speedGateEnabled = true,
): SpeedGateCommand => SpeedGateCommand.make({ lines, projects, speedGateEnabled })

interface SpeedGateReadout {
  readonly measuredProjects: ReadonlyArray<string>
  readonly mainMs: number
  readonly branchMs: number
  readonly slowerThanMain: ReadonlyArray<SlowerThanMain>
  readonly unmeasured: ReadonlyArray<SpeedGateUnmeasured>
}

const readoutOf = (decision: SpeedGateDecision): SpeedGateReadout =>
  Match.value(decision).pipe(
    Match.withReturnType<SpeedGateReadout>(),
    Match.tag('SpeedGateEvaluated', (evaluated) => ({
      measuredProjects: evaluated.measuredProjects,
      mainMs: evaluated.mainMs,
      branchMs: evaluated.branchMs,
      slowerThanMain: evaluated.slowerThanMain,
      unmeasured: [],
    })),
    Match.tag('SpeedGateUnmeasured', (unmeasured) => ({
      measuredProjects: [],
      mainMs: 0,
      branchMs: 0,
      slowerThanMain: [],
      unmeasured: [unmeasured],
    })),
    Match.exhaustive,
  )

const decisionOf = (subject: typeof speedGate, command: SpeedGateCommand): SpeedGateReadout =>
  subject(command).pipe(Result.getOrThrow, readoutOf)

describe('speedGate', () => {
  it.prop(
    '∀q_SummaryMeasuredCount_≡ProjectsComparedByTheSpeedGate',
    {
      of: [
        S.Literals(['fresh-check', 'group', 'digest', 'cached-check', 'none']),
        S.Literals(['fresh-check', 'group', 'digest', 'cached-check', 'none']),
        S.Literals(['group', 'digest']),
        S.Literals(['group', 'digest']),
        S.Int,
        S.Int,
        S.Int,
        S.Int,
      ],
      subject: speedGate,
    },
    (
      subject,
      [
        mainKind,
        branchKind,
        otherMainKind,
        otherBranchKind,
        drawnMainMs,
        drawnBranchMs,
        drawnOtherMainMs,
        drawnOtherBranchMs,
      ],
    ) => {
      const mainMs = digitsOf(drawnMainMs)
      const branchMs = digitsOf(drawnBranchMs)
      const otherMainMs = digitsOf(drawnOtherMainMs)
      const otherBranchMs = digitsOf(drawnOtherBranchMs)
      const phaseLineOrNone = (
        side: Side,
        project: string,
        kind: PhaseKind | 'none',
        ms: number,
      ): ReadonlyArray<ParityLine> => kind === 'none' ? [] : [phaseLineOf(side, project, kind, ms)]
      const lines = [
        ...phaseLineOrNone('main', PROJECT, mainKind, mainMs),
        ...phaseLineOrNone('branch', PROJECT, branchKind, branchMs),
        ...phaseLineOrNone('main', OTHER_PROJECT, otherMainKind, otherMainMs),
        ...phaseLineOrNone('branch', OTHER_PROJECT, otherBranchKind, otherBranchMs),
      ]
      const decision = decisionOf(subject, commandOf(lines, [PROJECT, OTHER_PROJECT]))
      const compared = (kind: PhaseKind | 'none', other: PhaseKind | 'none'): boolean =>
        kind === 'fresh-check' && other === 'fresh-check'
      const projectCompared = compared(mainKind, branchKind)
      const otherCompared = compared(otherMainKind, otherBranchKind)
      return decision.measuredProjects.length === (projectCompared ? 1 : 0) + (otherCompared ? 1 : 0) &&
        decision.mainMs === (projectCompared ? mainMs : 0) + (otherCompared ? otherMainMs : 0) &&
        decision.branchMs === (projectCompared ? branchMs : 0) + (otherCompared ? otherBranchMs : 0)
    },
  )

  it.prop(
    '∀t_OneSideWithoutFreshCheck_≡NeverSlowerThanMain',
    {
      of: [
        S.Int,
        S.Int,
        S.Literals(['fresh-check', 'group', 'digest', 'cached-check']),
        S.Literals(['group', 'digest', 'cached-check']),
      ],
      subject: speedGate,
    },
    (subject, [drawnMainMs, drawnBranchMs, mainKind, branchKind]) => {
      const mainMs = digitsOf(drawnMainMs)
      const branchMs = mainMs + digitsOf(drawnBranchMs) + 1
      const lines = [
        phaseLineOf('main', PROJECT, mainKind, mainMs),
        phaseLineOf('branch', PROJECT, branchKind, branchMs),
      ]
      return decisionOf(subject, commandOf(lines, [PROJECT])).slowerThanMain.length === 0
    },
  )

  it.prop(
    '∀t_FreshCheckBothSides_≡SlowerOnlyWhenBranchAtLeastMain',
    { of: [S.Int, S.Int], subject: speedGate },
    (subject, [drawnMainMs, drawnBranchMs]) => {
      const mainMs = digitsOf(drawnMainMs)
      const branchMs = digitsOf(drawnBranchMs)
      const lines = [
        phaseLineOf('main', PROJECT, 'fresh-check', mainMs),
        phaseLineOf('branch', PROJECT, 'fresh-check', branchMs),
      ]
      const decision = decisionOf(subject, commandOf(lines, [PROJECT]))
      const slower = decision.slowerThanMain.some((violation) =>
        S.is(SlowerThanMain)(violation) && violation.branchMs === branchMs && violation.mainMs === mainMs
      )
      return slower === (branchMs >= mainMs)
    },
  )

  it.prop(
    '∀g_SpeedGateOnNothingMeasured_≡WarningAndNoSpeedViolation',
    { of: [S.Int, S.Int], subject: speedGate },
    (subject, [drawnMainMs, drawnBranchMs]) => {
      const mainMs = digitsOf(drawnMainMs)
      const branchMs = mainMs + digitsOf(drawnBranchMs) + 1
      const lines = [
        phaseLineOf('main', PROJECT, 'group', mainMs),
        phaseLineOf('branch', PROJECT, 'group', branchMs),
      ]
      const decision = decisionOf(subject, commandOf(lines, [PROJECT]))
      return decision.unmeasured.length === 1 &&
        decision.unmeasured.every((warning) => S.is(SpeedGateUnmeasured)(warning) && warning.nextAction.length > 0) &&
        decision.slowerThanMain.length === 0
    },
  )

  it.prop(
    '∀g_SpeedGateOff_≡NoUnmeasuredWarning',
    { of: [S.Int], subject: speedGate },
    (subject, [drawnMs]) => {
      const ms = digitsOf(drawnMs)
      const lines = [
        phaseLineOf('main', PROJECT, 'group', ms),
        phaseLineOf('branch', PROJECT, 'group', ms),
      ]
      return decisionOf(subject, commandOf(lines, [PROJECT], false)).unmeasured.length === 0
    },
  )

  it.prop(
    '∀g_MeasuredProject_≡NoUnmeasuredWarning',
    { of: [S.Int], subject: speedGate },
    (subject, [drawnMs]) => {
      const ms = digitsOf(drawnMs)
      const lines = [
        phaseLineOf('main', PROJECT, 'fresh-check', ms),
        phaseLineOf('branch', PROJECT, 'fresh-check', ms),
      ]
      return decisionOf(subject, commandOf(lines, [PROJECT])).unmeasured.length === 0
    },
  )
})
