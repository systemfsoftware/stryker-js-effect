import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as S from 'effect/Schema'

import { EMPTY_COSTS, measuredCostsOf, mergeCosts } from '../file-costs.js'
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

const RUN_ID = 38049913120

const smallName = Arbitrary.schema(S.Literals(['a', 'b']))
const smallRun = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 3 })))

const rateArb: Arbitrary.Arbitrary<FileRate> = Arbitrary.all({
  project: smallName,
  fileName: smallName,
  msPerMutant: msArb,
  mutants: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 9 }))),
  runId: smallRun,
}).pipe(Arbitrary.map((fields) => FileRate.make(fields)))

const overheadArb: Arbitrary.Arbitrary<ProjectOverhead> = Arbitrary.all({
  project: smallName,
  ms: msArb,
  runId: smallRun,
}).pipe(Arbitrary.map((fields) => ProjectOverhead.make(fields)))

const distinctBy = <A>(
  entries: ReadonlyArray<A>,
  keyOf: (entry: A) => string,
): ReadonlyArray<A> => [...new Map(entries.map((entry) => [keyOf(entry), entry])).values()]

const tableArb: Arbitrary.Arbitrary<FileCosts> = Arbitrary.all({
  runs: Arbitrary.array(smallRun, { maxLength: 3 }),
  files: Arbitrary.array(rateArb, { maxLength: 4 }),
  projects: Arbitrary.array(overheadArb, { maxLength: 2 }),
}).pipe(
  Arbitrary.map(({ runs, files, projects }) =>
    FileCosts.make({
      schemaVersion: 3,
      runs: [...new Set(runs)].sort((left, right) => left - right),
      files: distinctBy(files, fileKey),
      projects: distinctBy(projects, (overhead) => overhead.project),
    })
  ),
)

const newestOf = <A extends { readonly runId: number }>(
  base: ReadonlyArray<A>,
  measured: ReadonlyArray<A>,
  keyOf: (entry: A) => string,
): ReadonlyArray<A> => {
  const kept = new Map<string, A>()
  for (const entry of [...base, ...measured]) {
    const earlier = kept.get(keyOf(entry))
    if (earlier === undefined || entry.runId >= earlier.runId) kept.set(keyOf(entry), entry)
  }
  return [...kept.values()]
}

const twoSidedArb = Arbitrary.all({
  project: nameArb,
  fileName: nameArb,
  mainMs: msArb,
  branchMs: msArb,
  mainIds: idsArb,
  branchIds: idsArb,
})

const stampedRateKeys = (rates: ReadonlyArray<FileRate>): ReadonlyArray<string> =>
  canonical(rates.map((rate) => `${rateKey(rate)}:${rate.runId}`))

const stampedOverheadKeys = (overheads: ReadonlyArray<ProjectOverhead>): ReadonlyArray<string> =>
  canonical(overheads.map((overhead) => `${overheadKey(overhead)}:${overhead.runId}`))

const runsOfMerge = (
  base: FileCosts,
  measured: { readonly files: ReadonlyArray<FileRate>; readonly projects: ReadonlyArray<ProjectOverhead> },
): ReadonlyArray<number> =>
  [
    ...new Set([
      ...base.runs,
      ...measured.files.map((rate) => rate.runId),
      ...measured.projects.map((overhead) => overhead.runId),
    ]),
  ].sort((left, right) => left - right)

const measuredBy = (table: FileCosts, runId: number) => ({
  files: table.files.map((rate) =>
    FileRate.make({
      project: rate.project,
      fileName: rate.fileName,
      msPerMutant: rate.msPerMutant,
      mutants: rate.mutants,
      runId,
    })
  ),
  projects: table.projects.map((overhead) =>
    ProjectOverhead.make({ project: overhead.project, ms: overhead.ms, runId })
  ),
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
      const { files } = subject([main, branch], RUN_ID)
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
      const withoutStale = subject(fresh, RUN_ID)
      const withStale = subject([...fresh, ...stale], RUN_ID)
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
      const { projects } = subject([digest('main', draw.mainMs), digest('branch', draw.branchMs)], RUN_ID)
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
    '∀n_EveryKey_≡NewestRunWinsAndUnmeasuredKeysStay',
    {
      of: [
        Arbitrary.all({
          base: tableArb,
          measured: Arbitrary.all({
            files: Arbitrary.array(rateArb, { maxLength: 4 }),
            projects: Arbitrary.array(overheadArb, { maxLength: 2 }),
          }).pipe(
            Arbitrary.map(({ files, projects }) => ({
              files: distinctBy(files, fileKey),
              projects: distinctBy(projects, (overhead) => overhead.project),
            })),
          ),
        }),
      ],
      subject: mergeCosts,
    },
    (subject, [draw]) => {
      const merged = subject({ base: draw.base, measured: draw.measured })
      const expectedFiles = newestOf(draw.base.files, draw.measured.files, fileKey)
      const expectedProjects = newestOf(draw.base.projects, draw.measured.projects, (overhead) => overhead.project)
      return (
        S.toEquivalence(S.Array(S.String))(stampedRateKeys(merged.files), stampedRateKeys(expectedFiles)) &&
        S.toEquivalence(S.Array(S.String))(
          stampedOverheadKeys(merged.projects),
          stampedOverheadKeys(expectedProjects),
        ) &&
        S.toEquivalence(S.Array(S.Finite))(merged.runs, runsOfMerge(draw.base, draw.measured))
      )
    },
  )

  it.prop(
    '∀c_TwoRunsInEitherOrder_≡SameTable',
    { of: [tableArb, tableArb], subject: mergeCosts },
    (subject, [older, newer]) => {
      const first = measuredBy(older, 1)
      const second = measuredBy(newer, 2)
      const forward = subject({ base: subject({ base: EMPTY_COSTS, measured: first }), measured: second })
      const backward = subject({ base: subject({ base: EMPTY_COSTS, measured: second }), measured: first })
      return S.toEquivalence(FileCosts)(forward, backward)
    },
  )
})
