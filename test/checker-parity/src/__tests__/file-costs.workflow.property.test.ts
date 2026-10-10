import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as S from 'effect/Schema'

import { measuredCostsOf, mergeCosts } from '../file-costs.js'
import {
  CheckCall,
  Deferred,
  DigestCall,
  FileCosts,
  FileRate,
  type ParityLine,
  ProjectOverhead,
  Side,
  UnitOverBudget,
} from '../Parity.schema.js'

const fileKey = (value: { readonly project: string; readonly fileName: string }): string =>
  `${value.project.length}:${value.project}${value.fileName}`

const nameArb = Arbitrary.schema(S.String.check(S.isMaxLength(3)))
const sideArb = Arbitrary.schema(Side)
const msArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 1000 })))
const idsArb = Arbitrary.array(Arbitrary.schema(S.String.check(S.isMaxLength(4))), { minLength: 1, maxLength: 3 })

interface CallDraw {
  readonly side: Side
  readonly project: string
  readonly fileName: string
  readonly ms: number
  readonly mutantIds: ReadonlyArray<string>
}

const callDrawArb: Arbitrary.Arbitrary<CallDraw> = Arbitrary.all({
  side: sideArb,
  project: nameArb,
  fileName: nameArb,
  ms: msArb,
  mutantIds: idsArb,
})

const checkCall = (draw: CallDraw, cached: boolean): CheckCall =>
  CheckCall.make({
    schemaVersion: 1,
    side: draw.side,
    project: draw.project,
    fileName: draw.fileName,
    callIndex: 0,
    mutantIds: draw.mutantIds,
    ms: draw.ms,
    cached,
  })

const digestCall = (draw: CallDraw, cached: boolean): DigestCall =>
  DigestCall.make({
    schemaVersion: 1,
    side: draw.side,
    project: draw.project,
    ms: draw.ms,
    digest: `${draw.project}:${draw.fileName}`,
    cached,
  })

const rateKey = (rate: FileRate): string => `${fileKey(rate)}:${rate.msPerMutant}:${rate.mutants}`
const overheadKey = (overhead: ProjectOverhead): string =>
  `${overhead.project.length}:${overhead.project}:${overhead.ms}`

const canonical = (keys: ReadonlyArray<string>): ReadonlyArray<string> => [...keys].sort()

const twoSidedArb = Arbitrary.all({
  project: nameArb,
  fileName: nameArb,
  mainMs: msArb,
  branchMs: msArb,
  mainIds: idsArb,
  branchIds: idsArb,
})

describe('measuredCostsOf', () => {
  it.prop(
    '∀s_TwoSides_≡RateFromTheSlowerSide',
    { of: [twoSidedArb], subject: measuredCostsOf },
    (subject, [draw]) => {
      const main = CheckCall.make({
        schemaVersion: 1,
        side: 'main',
        project: draw.project,
        fileName: draw.fileName,
        callIndex: 0,
        mutantIds: draw.mainIds,
        ms: draw.mainMs,
        cached: false,
      })
      const branch = CheckCall.make({
        schemaVersion: 1,
        side: 'branch',
        project: draw.project,
        fileName: draw.fileName,
        callIndex: 0,
        mutantIds: draw.branchIds,
        ms: draw.branchMs,
        cached: false,
      })
      const { files } = subject([main, branch])
      const mainRate = draw.mainMs / draw.mainIds.length
      const branchRate = draw.branchMs / draw.branchIds.length
      const winner = mainRate > branchRate
        ? main
        : branchRate > mainRate
        ? branch
        : draw.branchIds.length > draw.mainIds.length
        ? branch
        : main
      const rate = files[0]
      return (
        files.length === 1 &&
        rate !== undefined &&
        rate.project === draw.project &&
        rate.fileName === draw.fileName &&
        rate.mutants === winner.mutantIds.length &&
        rate.msPerMutant === winner.ms / winner.mutantIds.length
      )
    },
  )

  it.prop(
    '∀x_NonFreshLines_≡NeverMeasured',
    { of: [callDrawArb], subject: measuredCostsOf },
    (subject, [draw]) => {
      const fresh: ReadonlyArray<ParityLine> = [checkCall(draw, false), digestCall(draw, false)]
      const stale: ReadonlyArray<ParityLine> = [
        checkCall({ ...draw, ms: draw.ms + 100_000 }, true),
        digestCall({ ...draw, ms: draw.ms + 100_000 }, true),
        Deferred.make({
          schemaVersion: 1,
          side: draw.side,
          project: draw.project,
          fileName: draw.fileName,
          mutants: 1,
          reason: 'deadline-passed',
        }),
        UnitOverBudget.make({
          schemaVersion: 1,
          side: draw.side,
          project: draw.project,
          fileName: draw.fileName,
          mutantIds: draw.mutantIds,
          interrupts: 1,
          ms: draw.ms + 100_000,
        }),
      ]
      const withoutStale = subject(fresh)
      const withStale = subject([...fresh, ...stale])
      return (
        S.toEquivalence(S.Array(FileRate))(withoutStale.files, withStale.files) &&
        S.toEquivalence(S.Array(ProjectOverhead))(withoutStale.projects, withStale.projects)
      )
    },
  )

  it.prop(
    '∀o_TwoSidesOfAProject_≡OverheadIsTheSlowerSide',
    { of: [Arbitrary.all({ project: nameArb, mainMs: msArb, branchMs: msArb })], subject: measuredCostsOf },
    (subject, [draw]) => {
      const digest = (side: Side, ms: number): DigestCall =>
        DigestCall.make({ schemaVersion: 1, side, project: draw.project, ms, digest: draw.project, cached: false })
      const { projects } = subject([digest('main', draw.mainMs), digest('branch', draw.branchMs)])
      const overhead = projects[0]
      return (
        projects.length === 1 &&
        overhead !== undefined &&
        overhead.project === draw.project &&
        overhead.ms === Math.max(draw.mainMs, draw.branchMs)
      )
    },
  )
})

describe('mergeCosts', () => {
  it.prop(
    '∀m_MeasuredKeys_≡ReplaceAndKeepTheRest',
    {
      of: [
        Arbitrary.all({
          base: Arbitrary.schema(FileCosts),
          measuredFiles: Arbitrary.array(Arbitrary.schema(FileRate), { maxLength: 3 }),
          measuredProjects: Arbitrary.array(Arbitrary.schema(ProjectOverhead), { maxLength: 3 }),
          runId: Arbitrary.schema(S.String),
        }),
      ],
      subject: mergeCosts,
    },
    (subject, [draw]) => {
      const measured = { files: draw.measuredFiles, projects: draw.measuredProjects }
      const key = fileKey
      const measuredFileKeys = new Set(measured.files.map(key))
      const measuredProjectKeys = new Set(measured.projects.map((overhead) => overhead.project))
      const measuredAnything = measured.files.length > 0 || measured.projects.length > 0
      const merged = subject({ base: draw.base, measured, runId: draw.runId })
      const expectedFiles = [
        ...draw.base.files.filter((rate) => !measuredFileKeys.has(key(rate))),
        ...measured.files,
      ]
      const expectedProjects = [
        ...draw.base.projects.filter((overhead) => !measuredProjectKeys.has(overhead.project)),
        ...measured.projects,
      ]
      const expectedRuns = measuredAnything ? [...new Set([...draw.base.runs, draw.runId])] : draw.base.runs
      return (
        S.toEquivalence(S.Array(S.String))(
          canonical(merged.files.map(rateKey)),
          canonical(expectedFiles.map(rateKey)),
        ) &&
        S.toEquivalence(S.Array(S.String))(
          canonical(merged.projects.map(overheadKey)),
          canonical(expectedProjects.map(overheadKey)),
        ) &&
        S.toEquivalence(S.Array(S.String))(merged.runs, expectedRuns)
      )
    },
  )
})
