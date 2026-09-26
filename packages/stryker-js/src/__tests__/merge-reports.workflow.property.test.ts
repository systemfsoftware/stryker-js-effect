import { describe, it } from '@systemfsoftware/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { decodeMerge, writeEncoded } from '../merge-reports.cell.js'
import { MachineConsole } from '../reporting/machine-console.service.js'
import { RunMutantTested } from '../run-event.schema.js'

const META_TEXT = '{"package":"pkg-a","outcome":"success"}'
const PART_DIR = 'pkg-a'

const streamLineOf = (mutant: RunMutantTested): Effect.Effect<string> =>
  S.encodeEffect(S.fromJsonString(RunMutantTested))(mutant).pipe(Effect.orDie)

const place = (mutants: ReadonlyArray<RunMutantTested>) =>
  mutants.map((mutant, index) =>
    RunMutantTested.make({
      id: mutant.id,
      status: mutant.status,
      file: `src/file-${index % 3}.ts`,
      location: mutant.location,
      mutator: mutant.mutator,
      replacement: mutant.replacement,
      completed: mutant.completed,
      total: mutant.total,
    })
  )

const partFromStreamText = (streamText: string) => {
  const result = decodeMerge({
    packagesRaw: undefined,
    bytes: [{ dir: PART_DIR, metaText: META_TEXT, reportText: undefined, streamText }],
  })
  return Result.isSuccess(result) ? result.success.command.parts[0] : undefined
}

const partFromMutants = (mutants: ReadonlyArray<RunMutantTested>) =>
  Effect.forEach(place(mutants), streamLineOf).pipe(
    Effect.map((lines) => partFromStreamText(lines.length === 0 ? '{"_tag":"stream"}\n' : lines.join('\n'))),
  )

const expectedFiles = (mutants: ReadonlyArray<RunMutantTested>) => {
  const grouped: Record<string, ReadonlyArray<string>> = {}
  for (const mutant of mutants) {
    grouped[mutant.file] = [...(grouped[mutant.file] ?? []), `${mutant.id}:${mutant.mutator}`]
  }
  return grouped
}

interface ReportedFile {
  readonly mutants: ReadonlyArray<{ readonly id: string; readonly mutatorName: string }>
}

const reportedFiles = (files: Readonly<Record<string, ReportedFile>>) =>
  Object.fromEntries(
    Object.entries(files).map(([file, entry]) => [
      file,
      entry.mutants.map((mutant) => `${mutant.id}:${mutant.mutatorName}`),
    ]),
  )

const MODE_ARB: Arbitrary.Arbitrary<'human' | 'machine'> = Arbitrary.schema(S.Literals(['human', 'machine']))

const writeLayers = Layer.mergeAll(
  FileSystem.layerNoop({
    makeDirectory: () => Effect.void,
    writeFileString: () => Effect.void,
  }),
  Path.layer,
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
  MachineConsole.captureLayer.pipe(Layer.provideMerge(MachineConsole.layer)),
)

const printedSummaryOf = (mode: 'human' | 'machine', summary: string) =>
  Effect.gen(function*() {
    const machine = yield* MachineConsole
    yield* writeEncoded({
      body: { summary, report: undefined, unreadable: [] },
      raw: { parts: [], out: 'reports/out', partsDir: 'reports', skipped: [], unreadable: [], mode },
    })
    return machine.read()
  }).pipe(Effect.provide(writeLayers))

describe('merge-reports', () => {
  it.effect.prop(
    '∀ms_StreamedMutants_≡DecodedMergeRebuildsEachIntoItsFile',
    { of: [Arbitrary.schema(S.Array(RunMutantTested))], subject: partFromMutants },
    (subject, [mutants]) =>
      Effect.map(subject(mutants), (part) => {
        if (part === undefined) {
          return false
        }
        const expected = expectedFiles(place(mutants))
        if (Object.keys(expected).length === 0) {
          return part.label === PART_DIR && part.incomplete === false && part.report === undefined
        }
        if (part.report === undefined) {
          return false
        }
        return part.incomplete === true && JSON.stringify(reportedFiles(part.report.files)) === JSON.stringify(expected)
      }),
  )

  it.effect.prop(
    '∀ms_SummaryAndMode_≡PrintedOnlyForHuman',
    { of: [MODE_ARB, S.String], subject: printedSummaryOf },
    (subject, [mode, summary]) =>
      Effect.map(subject(mode, summary), (printed) => printed === (mode === 'human' ? summary : '')),
  )
})
