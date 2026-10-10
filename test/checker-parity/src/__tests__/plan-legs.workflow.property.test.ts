import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type CostSource, FileRate, PlannedLeg, type PlannedUnit, ProjectOverhead } from '../Parity.schema.js'
import {
  CorpusFile,
  LegsPlanned,
  NoCorpusMutants,
  planLegs,
  PlanLegsCommand,
  type PlanLegsDecision,
} from '../plan-legs.workflow.js'

const keyOf = (value: { readonly project: string; readonly fileName: string }): string =>
  `${value.project.length}:${value.project}${value.fileName}`

interface DistinctFile {
  readonly project: string
  readonly fileName: string
  readonly mutants: number
}

interface Sample {
  readonly project: string
  readonly fileName: string
  readonly msPerMutant: number
  readonly mutants: number
}

interface Estimate {
  readonly msPerMutant: number
  readonly source: CostSource
}

const distinctFiles = (files: ReadonlyArray<CorpusFile>): ReadonlyArray<DistinctFile> => {
  const maxByKey = new Map<string, DistinctFile>()
  for (const file of files) {
    const kept = maxByKey.get(keyOf(file))
    if (kept === undefined || file.mutants > kept.mutants) {
      maxByKey.set(keyOf(file), { project: file.project, fileName: file.fileName, mutants: file.mutants })
    }
  }
  return [...maxByKey.values()].filter((file) => file.mutants > 0)
}

const samplesOf = (rates: ReadonlyArray<FileRate>): ReadonlyArray<Sample> => {
  const maxByKey = new Map<string, Sample>()
  for (const rate of rates) {
    const kept = maxByKey.get(keyOf(rate))
    maxByKey.set(keyOf(rate), {
      project: rate.project,
      fileName: rate.fileName,
      msPerMutant: Math.max(rate.msPerMutant, kept?.msPerMutant ?? 0),
      mutants: Math.max(rate.mutants, kept?.mutants ?? 0),
    })
  }
  return [...maxByKey.values()]
}

const measuredRatesOf = (rates: ReadonlyArray<FileRate>): ReadonlyMap<string, number> =>
  new Map(samplesOf(rates).map((sample) => [keyOf(sample), sample.msPerMutant]))

const weightedMean = (samples: ReadonlyArray<Sample>): number =>
  samples.reduce((total, sample) => total + sample.msPerMutant * sample.mutants, 0) /
  samples.reduce((total, sample) => total + sample.mutants, 0)

const projectMeansOf = (samples: ReadonlyArray<Sample>): ReadonlyMap<string, number> => {
  const byProject = new Map<string, ReadonlyArray<Sample>>()
  for (const sample of samples) byProject.set(sample.project, [...(byProject.get(sample.project) ?? []), sample])
  return new Map([...byProject].map(([project, owned]) => [project, weightedMean(owned)]))
}

const corpusMeanOf = (samples: ReadonlyArray<Sample>): number | undefined =>
  samples.length === 0 ? undefined : weightedMean(samples)

const overheadsOf = (overheads: ReadonlyArray<ProjectOverhead>): {
  readonly byProject: ReadonlyMap<string, number>
  readonly max: number | undefined
} => {
  const byProject = new Map<string, number>()
  let max: number | undefined
  for (const overhead of overheads) {
    byProject.set(overhead.project, Math.max(overhead.ms, byProject.get(overhead.project) ?? 0))
    max = Math.max(max ?? 0, overhead.ms)
  }
  return { byProject, max }
}

const overheadOf = (
  overheads: { readonly byProject: ReadonlyMap<string, number>; readonly max: number | undefined },
  project: string,
): number => overheads.byProject.get(project) ?? overheads.max ?? 0

const blockSize = (mutants: number, blockMutants: number, index: number): number =>
  Math.min(blockMutants, mutants - index * blockMutants)

const rangeMutants = (mutants: number, blockMutants: number, from: number, to: number): number => {
  let total = 0
  for (let index = from; index < to; index += 1) total += blockSize(mutants, blockMutants, index)
  return total
}

const decisionOf = (subject: typeof planLegs, command: PlanLegsCommand): PlanLegsDecision =>
  Result.getOrThrow(subject(command))

const legsOf = (decision: PlanLegsDecision): ReadonlyArray<PlannedLeg> =>
  S.is(LegsPlanned)(decision) ? decision.legs : []

const unitsOfFile = (legs: ReadonlyArray<PlannedLeg>, file: DistinctFile): ReadonlyArray<PlannedUnit> => {
  const units: ReadonlyArray<PlannedUnit> = Arr.flatMap(legs, (leg) => leg.units)
  return units.filter((unit) => unit.project === file.project && unit.fileName === file.fileName)
}

const sortedByFrom = (units: ReadonlyArray<PlannedUnit>): ReadonlyArray<PlannedUnit> =>
  Arr.sort(units, Order.mapInput(Order.Number, (unit: PlannedUnit) => unit.fromBlock))

const tilesOnce = (command: PlanLegsCommand, legs: ReadonlyArray<PlannedLeg>, file: DistinctFile): boolean => {
  const sorted = sortedByFrom(unitsOfFile(legs, file))
  const blockCount = Math.ceil(file.mutants / command.blockMutants)
  const contiguousAt = (unit: PlannedUnit, index: number): boolean => {
    const previous = sorted[index - 1]
    return index === 0 || (previous !== undefined && previous.toBlock === unit.fromBlock)
  }
  const head = sorted[0]
  const tail = sorted[sorted.length - 1]
  const contiguous = sorted.length > 0 &&
    head !== undefined &&
    head.fromBlock === 0 &&
    sorted.every(contiguousAt) &&
    tail !== undefined &&
    tail.toBlock === blockCount
  const eachRange = sorted.every(
    (unit) =>
      unit.mutants === rangeMutants(file.mutants, command.blockMutants, unit.fromBlock, unit.toBlock) &&
      unit.fileMutants === file.mutants &&
      unit.toBlock > unit.fromBlock,
  )
  return contiguous && eachRange && sorted.reduce((total, unit) => total + unit.mutants, 0) === file.mutants
}

const entryArb = Arbitrary.all({
  project: Arbitrary.schema(S.String.check(S.isMaxLength(3))),
  fileName: Arbitrary.schema(S.String.check(S.isMaxLength(3))),
  mutants: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 60 }))),
  rate: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 40 })).pipe(S.NullOr)),
  overhead: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 400 })).pipe(S.NullOr)),
})

interface Entry {
  readonly project: string
  readonly fileName: string
  readonly mutants: number
  readonly rate: number | null
  readonly overhead: number | null
}

const commandOf = (entries: ReadonlyArray<Entry>, capacityMs: number, blockMutants: number): PlanLegsCommand =>
  PlanLegsCommand.make({
    files: entries.map((entry) =>
      CorpusFile.make({ project: entry.project, fileName: entry.fileName, mutants: entry.mutants })
    ),
    rates: entries.flatMap((entry) =>
      entry.rate === null
        ? []
        : [
          FileRate.make({
            project: entry.project,
            fileName: entry.fileName,
            msPerMutant: entry.rate,
            mutants: Math.max(1, entry.mutants),
          }),
        ]
    ),
    overheads: entries.flatMap((entry) =>
      entry.overhead === null
        ? []
        : [ProjectOverhead.make({ project: entry.project, ms: entry.overhead })]
    ),
    capacityMs,
    blockMutants,
  })

const commandArb: Arbitrary.Arbitrary<PlanLegsCommand> = Arbitrary.all({
  entries: Arbitrary.array(entryArb, { maxLength: 6 }),
  capacityMs: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 1200 }))),
  blockMutants: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 12 }))),
}).pipe(Arbitrary.map(({ entries, capacityMs, blockMutants }) => commandOf(entries, capacityMs, blockMutants)))

describe('planLegs', () => {
  it.prop(
    '∀a_DistinctFiles_≡BlockRangesTileTheFileExactlyOnce',
    { of: [commandArb], subject: planLegs },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      const legs = legsOf(decision)
      const files = distinctFiles(command.files)
      const allUnits: ReadonlyArray<PlannedUnit> = Arr.flatMap(legs, (leg) => leg.units)
      const everyUnitNamesAKnownFile = allUnits.every((unit) =>
        files.some((file) => file.project === unit.project && file.fileName === unit.fileName)
      )
      const tiles = tilesOnce
      return everyUnitNamesAKnownFile && files.every((file) => tiles(command, legs, file))
    },
  )

  it.prop(
    '∀b_EveryLeg_≡SumsItsUnitsAndDistinctProjectOverheads',
    { of: [commandArb], subject: planLegs },
    (subject, [command]) => {
      const legs = legsOf(decisionOf(subject, command))
      const overheads = overheadsOf(command.overheads)
      const ok = legs.every((leg) => {
        const unitMs = leg.units.reduce((total, unit) => total + unit.ms, 0)
        const projects = Arr.dedupe(leg.units.map((unit) => unit.project))
        const overhead = overheadOf
        const expected = unitMs + projects.reduce((total, project) => total + overhead(overheads, project), 0)
        return Math.abs(leg.ms - expected) <= 1e-9 * Math.max(1, Math.abs(expected))
      })
      return ok
    },
  )

  it.prop(
    '∀c_EveryLeg_≡FitsCapacityOrIsASingleOverCapacityUnit',
    { of: [commandArb], subject: planLegs },
    (subject, [command]) =>
      legsOf(decisionOf(subject, command)).every(
        (leg) => leg.ms <= command.capacityMs || leg.units.length === 1,
      ),
  )

  it.prop(
    '∀d_Legs_≡AtMostOneBelowHalfCapacity',
    { of: [commandArb], subject: planLegs },
    (subject, [command]) =>
      legsOf(decisionOf(subject, command)).filter((leg) => leg.ms * 2 <= command.capacityMs).length <= 1,
  )

  it.prop(
    '∀o_InputOrder_≡SameLegs',
    { of: [commandArb], subject: planLegs },
    (subject, [command]) => {
      const reversed = PlanLegsCommand.make({
        files: [...command.files].reverse(),
        rates: [...command.rates].reverse(),
        overheads: [...command.overheads].reverse(),
        capacityMs: command.capacityMs,
        blockMutants: command.blockMutants,
      })
      const first = decisionOf(subject, command)
      const again = decisionOf(subject, reversed)
      return (
        S.is(LegsPlanned)(first) === S.is(LegsPlanned)(again) &&
        S.toEquivalence(S.Array(PlannedLeg))(legsOf(first), legsOf(again))
      )
    },
  )

  it.prop(
    '∀e_NoFileWithMutants_≡NoCorpusMutants',
    { of: [commandArb], subject: planLegs },
    (subject, [command]) =>
      S.is(NoCorpusMutants)(decisionOf(subject, command)) === command.files.every((file) => file.mutants === 0),
  )

  it.prop(
    '∀m_MeasuredFile_≡MeasuredSourceAndMs',
    { of: [commandArb], subject: planLegs },
    (subject, [command]) => {
      const legs = legsOf(decisionOf(subject, command))
      const measured = measuredRatesOf(command.rates)
      const fileKey = keyOf
      const unitsFor = unitsOfFile
      return distinctFiles(command.files).every((file) => {
        const rate = measured.get(fileKey(file))
        if (rate === undefined) return true
        return unitsFor(legs, file).every((unit) => unit.source === 'measured' && unit.ms === unit.mutants * rate)
      })
    },
  )

  it.prop(
    '∀f_UnmeasuredFile_≡RateFromTheFallbackLadder',
    { of: [commandArb], subject: planLegs },
    (subject, [command]) => {
      const legs = legsOf(decisionOf(subject, command))
      const measured = measuredRatesOf(command.rates)
      const samples = samplesOf(command.rates)
      const fileKey = keyOf
      const unitsFor = unitsOfFile
      const projectMeans = projectMeansOf(samples)
      const corpusMean = corpusMeanOf(samples)
      const fallbackOf = (file: DistinctFile): Estimate => {
        if (projectMeans.has(file.project)) {
          return { msPerMutant: projectMeans.get(file.project) ?? 0, source: 'project-mean' }
        }
        if (corpusMean !== undefined) return { msPerMutant: corpusMean, source: 'corpus-mean' }
        return { msPerMutant: 10_000, source: 'no-measurements' }
      }
      return distinctFiles(command.files).every((file) => {
        if (measured.has(fileKey(file))) return true
        const expected = fallbackOf(file)
        return unitsFor(legs, file).every(
          (unit) =>
            unit.source === expected.source &&
            Math.abs(unit.ms - unit.mutants * expected.msPerMutant) <= 1e-9 * Math.max(1, Math.abs(unit.ms)),
        )
      })
    },
  )
})
