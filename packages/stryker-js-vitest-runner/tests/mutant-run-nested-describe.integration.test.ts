import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { layer as NodeCryptoLayer } from '@effect/platform-node/NodeCrypto'
import { Instrument, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { layer } from '../src/VitestRunner.service.js'

const MATH_SOURCE = [
  'export function divide(a: number, b: number): number {',
  '  return a / b',
  '}',
  '',
  'export function halve(a: number): number {',
  '  return a / 2',
  '}',
  '',
].join('\n')

const NESTED_SUITE = [
  "import { describe, it } from 'vitest'",
  "import { halve } from '../src/math.js'",
  '',
  "describe('math', () => {",
  "  describe('positive input', () => {",
  "    it('halves six', () => {",
  '      if (halve(6) !== 3) {',
  "        throw new Error('expected halve(6) to be 3')",
  '      }',
  '    })',
  '  })',
  '})',
  '',
  "describe.each([2, 4])('each %i', (n) => {",
  "  it('halves n', () => {",
  '    if (halve(n) !== n / 2) {',
  "      throw new Error('expected halve(n) to be n / 2')",
  '    }',
  '  })',
  '})',
  '',
].join('\n')

const TOP_SUITE = [
  "import { it } from 'vitest'",
  "import { divide } from '../src/math.js'",
  '',
  "it('divides at the top level', () => {",
  '  if (divide(8, 2) !== 4) {',
  "    throw new Error('expected 8 / 2 to be 4')",
  '  }',
  '})',
  '',
].join('\n')

const NESTED_ID = 'tests/nested.spec.ts#math > positive input > halves six'
const EACH_2_ID = 'tests/nested.spec.ts#each 2 > halves n'
const EACH_4_ID = 'tests/nested.spec.ts#each 4 > halves n'
const TOP_ID = 'tests/top.spec.ts#divides at the top level'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCryptoLayer)

const sandboxDirectory = new URL('../testResources/tmp/nested-describe', import.meta.url).pathname

const setupFilePath = new URL('../dist/stryker-setup.mjs', import.meta.url).pathname

const writeSandbox = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.remove(sandboxDirectory, { recursive: true, force: true }).pipe(Effect.orElseSucceed(() => undefined))
  yield* fs.makeDirectory(sandboxDirectory, { recursive: true })
  yield* fs.writeFileString(
    path.join(sandboxDirectory, 'package.json'),
    '{"name":"nested-describe-sandbox","type":"module"}',
  )
  yield* fs.makeDirectory(path.join(sandboxDirectory, 'src'))
  yield* fs.makeDirectory(path.join(sandboxDirectory, 'tests'))
  const instrumented = yield* Instrument.instrument(
    [{ name: 'src/math.ts', content: MATH_SOURCE, mutate: true }],
    { excludedMutations: [], ignorers: [] },
  )
  for (const file of instrumented.files) {
    yield* fs.writeFileString(path.join(sandboxDirectory, file.name), file.content)
  }
  yield* fs.writeFileString(path.join(sandboxDirectory, 'tests/nested.spec.ts'), NESTED_SUITE)
  yield* fs.writeFileString(path.join(sandboxDirectory, 'tests/top.spec.ts'), TOP_SUITE)
  return instrumented
})

const removeSandbox = Effect.flatMap(
  FileSystem.FileSystem,
  (fs) => fs.remove(sandboxDirectory, { recursive: true, force: true }),
)

const coveringIdsOf = (dryRun: TestRunner.DryRunResult, mutantId: string): readonly string[] =>
  dryRun.status === 'complete'
    ? Object.entries(dryRun.mutantCoverage?.perTest ?? {}).filter(([, hits]) => mutantId in hits).map(([testId]) =>
      testId
    )
    : []

const mutantWithReplacement = (mutants: readonly Mutant.Mutant[], replacement: string): Mutant.Mutant => {
  const found = mutants.find((mutant) => mutant.replacement === replacement)
  if (found === undefined) {
    throw new Error(`the instrumenter produced no mutant with replacement ${replacement}`)
  }
  return found
}

const runMutant = (runner: TestRunner.TestRunnerService, mutant: Mutant.Mutant, testFilter: readonly string[]) =>
  runner.mutantRun({
    timeout: 60_000,
    disableBail: true,
    activeMutant: mutant,
    sandboxFileName: 'src/math.ts',
    testFilter: [...testFilter],
    mutantActivation: 'runtime',
    reloadEnvironment: true,
  })

describe('mutant runs against tests inside describe blocks', () => {
  let instrumented: Instrument.InstrumentResult

  beforeAll(() =>
    writeSandbox.pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          instrumented = result
        })
      ),
      Effect.provide(platform),
      Effect.orDie,
      Effect.runPromise,
    )
  )

  afterAll(() => removeSandbox.pipe(Effect.provide(platform), Effect.orDie, Effect.runPromise))

  it(
    'runs exactly the covering tests and kills the mutants they observe',
    () =>
      Effect.gen(function*() {
        const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({
          testRunner: 'vitest',
          disableBail: true,
        }).pipe(Effect.orDie)
        const runner = yield* TestRunner.TestRunner.pipe(
          Effect.provide(Layer.provideMerge(layer({ options, sandboxDirectory, setupFilePath }), platform)),
          Effect.scoped,
        )
        const halveMutant = mutantWithReplacement(instrumented.mutants, 'a * 2')
        const divideMutant = mutantWithReplacement(instrumented.mutants, 'a * b')

        const dryRun = yield* runner.dryRun({ timeout: 60_000, disableBail: true, coverageAnalysis: 'perTest' })
        expect(dryRun).toMatchObject({
          status: 'complete',
          tests: [{ id: NESTED_ID }, { id: EACH_2_ID }, { id: EACH_4_ID }, { id: TOP_ID }],
        })
        expect(coveringIdsOf(dryRun, halveMutant.id)).toEqual([NESTED_ID, EACH_2_ID, EACH_4_ID])
        expect(coveringIdsOf(dryRun, divideMutant.id)).toEqual([TOP_ID])

        const nestedRun = yield* runMutant(runner, halveMutant, coveringIdsOf(dryRun, halveMutant.id))
        expect(nestedRun).toMatchObject({ status: 'killed', killedBy: [NESTED_ID, EACH_2_ID, EACH_4_ID], nrOfTests: 3 })

        const topRun = yield* runMutant(runner, divideMutant, coveringIdsOf(dryRun, divideMutant.id))
        expect(topRun).toMatchObject({ status: 'killed', killedBy: [TOP_ID], nrOfTests: 1 })
      }).pipe(Effect.runPromise),
    240_000,
  )
})
