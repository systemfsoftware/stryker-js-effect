import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BootAsymmetry,
  compareSides,
  CompareSidesCommand,
  type ComparisonDecision,
  NothingCompared,
  ParityBroken,
  ParityHolds,
  SlowerThanMain,
  VerdictMismatch,
  ZeroShortcuts,
  ZeroSnapshotUpdates,
} from '../compare-sides.workflow.js'
import {
  CheckCall,
  Counts,
  Gates,
  ParityLine,
  ProjectBootFailed,
  ProjectSkipped,
  type Side,
  TelemetryMissing,
  Verdict,
  VerdictStatus,
} from '../Parity.schema.js'

const PROJECT = 'packages/example/tsconfig.app.json'
const OTHER_PROJECT = 'packages/other/tsconfig.app.json'
const FIXTURE = 'test/checker-parity/__fixtures__/isolated-declarations/tsconfig.json'
const FILE = 'packages/example/src/a.ts'

const GATES_OFF: Gates = { shortcutCount: false, speed: false }
const GATES_ON: Gates = { shortcutCount: true, speed: true }

const STATUSES = ['passed', 'compileError', 'ignored'] as const

const nextStatus = (status: VerdictStatus): VerdictStatus =>
  STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length] ?? 'passed'

const digitsOf = (draw: number): number => Math.abs(draw)
const countOf = (draw: number): number => Math.abs(draw) % 141
const smallCountOf = (draw: number): number => Math.abs(draw) % 9
const stripNewlines = (value: string): string => value.replace(/[\r\n]/gu, '')

interface VerdictFields {
  readonly project?: string
  readonly mutantId: string
  readonly fileName?: string
  readonly line?: number
  readonly status?: VerdictStatus
  readonly reason?: string
  readonly cached?: boolean
}

const verdictOf = (side: Side, fields: VerdictFields): Verdict =>
  Verdict.make({
    schemaVersion: 1,
    side,
    project: fields.project ?? PROJECT,
    mutantId: fields.mutantId,
    fileName: fields.fileName ?? FILE,
    line: fields.line ?? 1,
    status: fields.status ?? 'passed',
    reason: fields.reason,
    cached: fields.cached ?? false,
  })

interface CountsFields {
  readonly importerShortcuts?: number
  readonly snapshotUpdates?: number
  readonly resplices?: number
  readonly tceBuilds?: number
}

const countsOf = (project: string, fields: CountsFields = {}): Counts =>
  Counts.make({
    schemaVersion: 1,
    side: 'branch',
    project,
    snapshotUpdates: fields.snapshotUpdates ?? 1,
    resplices: fields.resplices ?? 0,
    tceBuilds: fields.tceBuilds ?? 1,
    tceMs: 1,
    importerShortcuts: fields.importerShortcuts ?? 1,
    fallbacks: {},
    checkSpans: 1,
  })

const checkCallOf = (
  side: Side,
  project: string,
  callIndex: number,
  mutantIds: ReadonlyArray<string>,
  ms: number,
  cached = false,
): CheckCall => CheckCall.make({ schemaVersion: 1, side, project, fileName: FILE, callIndex, mutantIds, ms, cached })

const bootOf = (side: Side, project: string, reason: string): ProjectBootFailed =>
  ProjectBootFailed.make({ schemaVersion: 1, side, project, reason })

const skippedOf = (project: string, reason: string): ProjectSkipped =>
  ProjectSkipped.make({ schemaVersion: 1, project, reason })

const commandOf = (
  lines: ReadonlyArray<ParityLine>,
  gates: Gates = GATES_OFF,
  isolatedDeclarationsProject = FIXTURE,
): CompareSidesCommand => CompareSidesCommand.make({ lines, gates, isolatedDeclarationsProject })

const decisionOf = (subject: typeof compareSides, command: CompareSidesCommand): ComparisonDecision =>
  Result.getOrThrow(subject(command))

const violationsOf = (decision: ComparisonDecision): ReadonlyArray<{ code: string; nextAction: string }> =>
  S.is(ParityBroken)(decision) ? decision.violations : []

describe('compareSides', () => {
  it.prop(
    '∀v_IdenticalSides_≡ParityHolds',
    { of: [S.NonEmptyString, S.NonEmptyString, VerdictStatus], subject: compareSides },
    (subject, [mutantId, reason, status]) => {
      const lines = [
        verdictOf('main', { mutantId, status, reason }),
        verdictOf('branch', { mutantId, status, reason }),
        countsOf(PROJECT),
      ]
      return S.is(ParityHolds)(decisionOf(subject, commandOf(lines)))
    },
  )

  it.prop(
    '∀s_DivergentStatus_≡RefusedNamingTheMutant',
    { of: [S.NonEmptyString, VerdictStatus], subject: compareSides },
    (subject, [mutantId, mainStatus]) => {
      const branchStatus = nextStatus(mainStatus)
      const lines = [
        verdictOf('main', { mutantId, status: mainStatus }),
        verdictOf('branch', { mutantId, status: branchStatus }),
        countsOf(PROJECT),
      ]
      const decision = decisionOf(subject, commandOf(lines))
      return S.is(ParityBroken)(decision) &&
        decision.violations.some((violation) =>
          S.is(VerdictMismatch)(violation) &&
          violation.mutantId === mutantId &&
          violation.main?.status === mainStatus &&
          violation.branch?.status === branchStatus
        )
    },
  )

  it.prop(
    '∀v_OneSidedMutant_≡Refused',
    { of: [S.NonEmptyString, VerdictStatus], subject: compareSides },
    (subject, [mutantId, status]) => {
      const decision = decisionOf(subject, commandOf([verdictOf('main', { mutantId, status })]))
      return S.is(ParityBroken)(decision) &&
        decision.violations.some((violation) =>
          S.is(VerdictMismatch)(violation) &&
          violation.mutantId === mutantId &&
          violation.main !== null &&
          violation.branch === null
        )
    },
  )

  it.prop(
    '∀c_OwnFilePositionOnly_≡ParityHolds',
    { of: [S.String, S.String, S.Int, S.Int, S.Int, S.Int], subject: compareSides },
    (subject, [drawnRoot, drawnFileName, drawnMainLine, drawnMainColumn, drawnBranchLine, drawnBranchColumn]) => {
      const fileName = stripNewlines(drawnFileName)
      const absolute = `/${stripNewlines(drawnRoot)}/${fileName}`
      const lines = [
        verdictOf('main', {
          mutantId: 'm',
          fileName,
          status: 'compileError',
          reason: `${absolute}(${digitsOf(drawnMainLine)},${digitsOf(drawnMainColumn)}): a diagnostic`,
        }),
        verdictOf('branch', {
          mutantId: 'm',
          fileName,
          status: 'compileError',
          reason: `${absolute}(${digitsOf(drawnBranchLine)},${digitsOf(drawnBranchColumn)}): a diagnostic`,
        }),
        countsOf(PROJECT),
      ]
      return S.is(ParityHolds)(decisionOf(subject, commandOf(lines)))
    },
  )

  it.prop(
    '∀c_OtherFilePositionDiffers_≡Refused',
    { of: [S.String, S.String, S.Int, S.Int], subject: compareSides },
    (subject, [drawnRoot, drawnFileName, drawnMainLine, drawnMainColumn]) => {
      const fileName = stripNewlines(drawnFileName)
      const otherFile = `/${stripNewlines(drawnRoot)}/other-${fileName}`
      const mainLine = digitsOf(drawnMainLine)
      const mainColumn = digitsOf(drawnMainColumn)
      const lines = [
        verdictOf('main', {
          mutantId: 'm',
          fileName,
          status: 'compileError',
          reason: `${otherFile}(${mainLine},${mainColumn}): a diagnostic`,
        }),
        verdictOf('branch', {
          mutantId: 'm',
          fileName,
          status: 'compileError',
          reason: `${otherFile}(${mainLine + 1},${mainColumn + 1}): a diagnostic`,
        }),
        countsOf(PROJECT),
      ]
      return S.is(ParityBroken)(decisionOf(subject, commandOf(lines)))
    },
  )

  it.prop(
    '∀m_ShortcutGate_≡FailsOnlyWhenOn',
    { of: [S.NonEmptyString], subject: compareSides },
    (subject, [mutantId]) => {
      const lines = [
        verdictOf('main', { mutantId }),
        verdictOf('branch', { mutantId }),
        countsOf(PROJECT, { importerShortcuts: 0 }),
      ]
      const on = decisionOf(subject, commandOf(lines, { shortcutCount: true, speed: false }))
      const off = decisionOf(subject, commandOf(lines, { shortcutCount: false, speed: false }))
      const failedOn = S.is(ParityBroken)(on) &&
        on.violations.some((violation) => S.is(ZeroShortcuts)(violation) && violation.scope === 'overall')
      const failedOff = S.is(ParityBroken)(off) &&
        off.violations.some((violation) => S.is(ZeroShortcuts)(violation))
      return failedOn && !failedOff
    },
  )

  it.prop(
    '∀m_FixtureZeroShortcuts_≡RefusedForTheFixtureOnly',
    { of: [S.NonEmptyString], subject: compareSides },
    (subject, [mutantId]) => {
      const lines = [
        verdictOf('main', { project: PROJECT, mutantId }),
        verdictOf('branch', { project: PROJECT, mutantId }),
        countsOf(PROJECT, { importerShortcuts: 5 }),
        countsOf(FIXTURE, { importerShortcuts: 0 }),
      ]
      const decision = decisionOf(subject, commandOf(lines, { shortcutCount: true, speed: false }))
      return S.is(ParityBroken)(decision) &&
        decision.violations.some((violation) =>
          S.is(ZeroShortcuts)(violation) && violation.scope === 'isolatedDeclarations'
        ) &&
        !decision.violations.some((violation) => S.is(ZeroShortcuts)(violation) && violation.scope === 'overall')
    },
  )

  it.prop(
    '∀m_CheckedButZeroUpdates_≡Refused',
    { of: [S.NonEmptyString], subject: compareSides },
    (subject, [mutantId]) => {
      const checked = [verdictOf('main', { mutantId }), verdictOf('branch', { mutantId })]
      const withZero = decisionOf(subject, commandOf([...checked, countsOf(PROJECT, { snapshotUpdates: 0 })]))
      const without = decisionOf(subject, commandOf(checked))
      const refusedWith = S.is(ParityBroken)(withZero) &&
        withZero.violations.some((violation) => S.is(ZeroSnapshotUpdates)(violation) && violation.project === PROJECT)
      const refusedWithout = S.is(ParityBroken)(without) &&
        without.violations.some((violation) => S.is(ZeroSnapshotUpdates)(violation))
      return refusedWith && refusedWithout
    },
  )

  it.prop(
    '∀m_CachedBranchOnly_≡NoZeroUpdatesRefusal',
    { of: [S.NonEmptyString], subject: compareSides },
    (subject, [mutantId]) => {
      const lines = [verdictOf('main', { mutantId }), verdictOf('branch', { mutantId, cached: true })]
      return S.is(ParityHolds)(decisionOf(subject, commandOf(lines)))
    },
  )

  it.prop(
    '∀b_OneSideBootFailure_≡Refused',
    { of: [S.NonEmptyString], subject: compareSides },
    (subject, [mutantId]) => {
      const lines = [bootOf('main', PROJECT, 'dry run failed'), verdictOf('branch', { mutantId }), countsOf(PROJECT)]
      const decision = decisionOf(subject, commandOf(lines))
      return S.is(ParityBroken)(decision) &&
        decision.violations.some((violation) =>
          S.is(BootAsymmetry)(violation) && violation.project === PROJECT && violation.failedSide === 'main'
        )
    },
  )

  it.prop(
    '∀b_BothSidesBootFailure_≡Skipped',
    { of: [S.NonEmptyString], subject: compareSides },
    (subject, [reason]) => {
      const lines = [
        bootOf('main', PROJECT, reason),
        bootOf('branch', PROJECT, reason),
        verdictOf('main', { project: OTHER_PROJECT, mutantId: 'm' }),
        verdictOf('branch', { project: OTHER_PROJECT, mutantId: 'm' }),
        countsOf(OTHER_PROJECT),
      ]
      const decision = decisionOf(subject, commandOf(lines))
      return S.is(ParityHolds)(decision) &&
        decision.summary.skipped.some((entry) => entry.project === PROJECT)
    },
  )

  it.prop(
    '∀n_NoMutantOnAnyMeasuredProject_≡NothingCompared',
    { of: [S.NonEmptyString, S.Boolean], subject: compareSides },
    (subject, [reason, bootFailed]) => {
      const lines = bootFailed
        ? [bootOf('main', PROJECT, reason), bootOf('branch', PROJECT, reason)]
        : [skippedOf(PROJECT, reason)]
      const violations = violationsOf(decisionOf(subject, commandOf(lines)))
      return violations.length === 1 && S.is(NothingCompared)(violations[0])
    },
  )

  it.prop(
    '∀t_SpeedGate_≡FailsOnlyWhenBranchNotFaster',
    { of: [S.NonEmptyString, S.Int, S.Int], subject: compareSides },
    (subject, [mutantId, drawnMainMs, drawnBranchMs]) => {
      const mainMs = digitsOf(drawnMainMs)
      const branchMs = digitsOf(drawnBranchMs)
      const lines = [
        verdictOf('main', { mutantId }),
        verdictOf('branch', { mutantId }),
        countsOf(PROJECT),
        checkCallOf('main', PROJECT, 0, [mutantId], mainMs),
        checkCallOf('branch', PROJECT, 0, [mutantId], branchMs),
      ]
      const decision = decisionOf(subject, commandOf(lines, { shortcutCount: false, speed: true }))
      const slower = S.is(ParityBroken)(decision) &&
        decision.violations.some((violation) =>
          S.is(SlowerThanMain)(violation) && violation.branchMs === branchMs && violation.mainMs === mainMs
        )
      return slower === (branchMs >= mainMs)
    },
  )

  it.prop(
    '∀t_CachedProjects_≡NeverInTheSpeedSum',
    { of: [S.Int, S.Int, S.Int], subject: compareSides },
    (subject, [drawnBranchMs, drawnExtra, drawnCachedMs]) => {
      const branchMs = digitsOf(drawnBranchMs)
      const mainMs = branchMs + digitsOf(drawnExtra) + 1
      const cachedMs = digitsOf(drawnCachedMs)
      const lines = [
        verdictOf('main', { mutantId: 'm' }),
        verdictOf('branch', { mutantId: 'm' }),
        countsOf(PROJECT),
        checkCallOf('main', PROJECT, 0, ['m'], mainMs),
        checkCallOf('branch', PROJECT, 0, ['m'], branchMs),
        checkCallOf('main', OTHER_PROJECT, 0, [], cachedMs, true),
        checkCallOf('branch', OTHER_PROJECT, 0, [], cachedMs, true),
      ]
      const decision = decisionOf(subject, commandOf(lines, { shortcutCount: false, speed: true }))
      return S.is(ParityHolds)(decision) &&
        decision.summary.main.phaseMs === mainMs &&
        decision.summary.branch.phaseMs === branchMs &&
        decision.summary.measuredProjectCount === 1 &&
        decision.summary.excludedCachedProjectCount === 1
    },
  )

  it.prop(
    '∀c_DerivedMainUpdates_≡CheckCallsPlusMutantsPlusResplices',
    { of: [S.Int, S.Int, S.Int], subject: compareSides },
    (subject, [drawnCheckCalls, drawnMutants, drawnResplices]) => {
      const checkCalls = smallCountOf(drawnCheckCalls)
      const mutants = smallCountOf(drawnMutants) + 1
      const resplices = smallCountOf(drawnResplices)
      const lines = [
        ...Array.from({ length: checkCalls }, (_, index) => checkCallOf('main', PROJECT, index, [], 1)),
        ...Array.from(
          { length: mutants },
          (_, index) => [
            verdictOf('main', { mutantId: `m${index}` }),
            verdictOf('branch', { mutantId: `m${index}` }),
          ],
        ).flat(),
        countsOf(PROJECT, { resplices }),
      ]
      const decision = decisionOf(subject, commandOf(lines))
      return S.is(ParityHolds)(decision) &&
        decision.summary.main.snapshotUpdates === checkCalls + mutants + resplices &&
        decision.summary.main.countsDerived === true &&
        decision.summary.branch.countsDerived === false
    },
  )

  it.prop(
    '∀m_BoundedDisplay_≡CappedAtFiftyWithOmittedCount',
    { of: [S.Int, S.Int], subject: compareSides },
    (subject, [drawnMutants, drawnMismatches]) => {
      const mutantCount = countOf(drawnMutants) + 1
      const mismatches = Math.min(countOf(drawnMismatches), mutantCount)
      const lines = [
        ...Array.from(
          { length: mutantCount },
          (_, index) => [
            verdictOf('main', { mutantId: `m${index}` }),
            verdictOf('branch', { mutantId: `m${index}`, status: index < mismatches ? 'compileError' : 'passed' }),
          ],
        ).flat(),
        countsOf(PROJECT),
      ]
      const decision = decisionOf(subject, commandOf(lines))
      const violations = violationsOf(decision)
      const displayed = S.is(ParityBroken)(decision) ? decision.displayed : []
      const omittedCount = S.is(ParityBroken)(decision) ? decision.omittedCount : 0
      return violations.length === mismatches &&
        displayed.length === Math.min(50, mismatches) &&
        displayed.length + omittedCount === violations.length &&
        violations.every((violation) => violation.nextAction.length > 0)
    },
  )

  it.prop(
    '∀v_EveryViolationKind_≡ReachedWithANextAction',
    { of: [S.NonEmptyString], subject: compareSides },
    (subject, [mutantId]) => {
      const lines = [
        verdictOf('main', { project: PROJECT, mutantId }),
        verdictOf('branch', { project: PROJECT, mutantId, status: 'compileError' }),
        bootOf('main', OTHER_PROJECT, 'dry run failed'),
        countsOf(PROJECT, { importerShortcuts: 0, snapshotUpdates: 0 }),
        TelemetryMissing.make({
          schemaVersion: 1,
          side: 'main',
          project: PROJECT,
          expectedSpans: 2,
          receivedSpans: 0,
        }),
        checkCallOf('main', OTHER_PROJECT, 0, [], 100),
        checkCallOf('branch', OTHER_PROJECT, 0, [], 200),
      ]
      const violations = violationsOf(decisionOf(subject, commandOf(lines, GATES_ON)))
      const codes = new Set(violations.map((violation) => violation.code))
      return [
        'verdict-mismatch',
        'boot-asymmetry',
        'zero-snapshot-updates',
        'telemetry-missing',
        'zero-shortcuts',
        'slower-than-main',
      ].every((code) => codes.has(code)) &&
        violations.every((violation) => violation.nextAction.length > 0)
    },
  )
})
