import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

import { type ReusableReport, reusableReportOf } from './__fixtures__/reusable-report.schema.js'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const SOURCE = [
  'export const add = (left: number, right: number): number => left + right',
  'export const label = (): string => "value"',
  '',
].join('\n')

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

interface RecordedMutant {
  readonly id: string
  readonly status: string
  readonly statusReason?: string | undefined
}

const mutantsOf = (text: string): readonly RecordedMutant[] =>
  Option.match(S.decodeOption(S.fromJsonString(Engine.IncrementalReportSchema))(text), {
    onNone: () => [],
    onSome: (value) => Object.values(value.files).flatMap((file) => file.mutants),
  })

const mutantIdsInOf = (report: ReusableReport, file: string): readonly string[] =>
  (report.files[file]?.mutants ?? []).map((mutant) => mutant.id)

const staticIdsOf = (report: ReusableReport): ReadonlySet<string> =>
  new Set(
    Object.entries(report.dryRunCoverage?.mutantCoverage?.static ?? {})
      .filter(([, count]) => count > 0)
      .map(([id]) => id),
  )

const fileOfCoverageKey = (key: string): string => key.split('#', 1)[0] ?? key

const coveringFilesOf = (report: ReusableReport, mutantId: string): ReadonlySet<string> =>
  new Set(
    Object.entries(report.dryRunCoverage?.mutantCoverage?.perTest ?? {})
      .filter(([, coverage]) => (coverage[mutantId] ?? 0) > 0)
      .map(([testId]) => fileOfCoverageKey(testId)),
  )

interface RunObservation {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly events: ReadonlyArray<RunEvent.RunEvent>
  readonly reuse: RunEvent.ReuseReported | undefined
  readonly verdict: RunEvent.VerdictReached | undefined
  readonly mutants: readonly RecordedMutant[]
  readonly incrementalText: string
}

const lineCountOf = (file: string): Effect.Effect<number, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(file)),
    Effect.map((text) => text.split('\n').filter((line) => line.length > 0).length),
    Effect.orElseSucceed(() => 0),
  )

const writeFixture = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* Effect.forEach(
      files,
      ([file, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return root
  }).pipe(Effect.orDie)

const removeFixture = (root: string): Effect.Effect<void, never, never> =>
  Effect.provide(
    Effect.orDie(
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })),
    ),
    filePorts,
  )

const runOnce = (root: string, options: Options.PartialStrykerOptions): Effect.Effect<RunObservation, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports),
      ports,
    )
    const exit = yield* Engine.mutationTestCell
      .run({ cliOptions: options, targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = [
      ...(yield* Queue.end(queue).pipe(
        Effect.andThen(Queue.takeAll(queue)),
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    const incrementalText = yield* fs.readFileString(path.join(root, 'reports', 'main.json')).pipe(
      Effect.orElseSucceed(() => ''),
    )
    const reuse = events.find((event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event))
    const verdict = events.find((event): event is RunEvent.VerdictReached => S.is(RunEvent.VerdictReached)(event))
    return { exit, events, reuse, verdict, mutants: mutantsOf(incrementalText), incrementalText }
  }).pipe(Effect.provide(filePorts))

const optionsOf = (
  root: string,
  extras: Partial<Options.PartialStrykerOptions> = {},
): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command: 'true' },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
  ...extras,
})

const ZERO_REFUSALS = {
  semanticsChanged: 0,
  policyChanged: 0,
  runInputsChanged: 0,
  closureChanged: 0,
  flakyDependency: 0,
  timeoutUnreproduced: 0,
  noPriorRecord: 0,
}

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const VM_PACKAGE_SOURCE = '{ "type": "commonjs" }\n'

const VM_MATH_SOURCE = [
  'function add(left, right) {',
  '  return left + right;',
  '}',
  '',
  'module.exports = { add };',
  '',
].join('\n')

const VM_OTHER_SOURCE = [
  'function label() {',
  "  return 'left' + 'right';",
  '}',
  '',
  'module.exports = { label };',
  '',
].join('\n')

const VM_PASSING_TEST = [
  "import { test } from 'vitest'",
  "import math from '../src/math.js'",
  '',
  "test('executes add without asserting on its result', () => {",
  '  math.add(1, 2)',
  '})',
  '',
].join('\n')

const VM_KILLING_TEST = [
  "import { expect, test } from 'vitest'",
  "import math from '../src/math.js'",
  '',
  "test('adds two numbers', () => {",
  '  let spin = 0',
  '  for (let index = 0; index < 20000000; index += 1) {',
  '    spin += index % 3',
  '  }',
  '  expect(spin).toBeGreaterThan(0)',
  '  expect(math.add(1, 2)).toBe(3)',
  '})',
  '',
].join('\n')

const VM_OTHER_TEST = [
  "import { test } from 'vitest'",
  "import other from '../src/other.js'",
  '',
  ...Array.from(
    { length: 24 },
    (_unused, index) => `test('touches label ${index}', () => {\n  other.label()\n})`,
  ),
  '',
].join('\n')

const VM_LEFT_TEST = [
  "import { expect, test } from 'vitest'",
  "import { add } from '../src/left.mjs'",
  "import { offset } from './left-helper.mjs'",
  '',
  "test('adds two numbers', () => {",
  '  expect(add(1, 2) + offset()).toBe(3)',
  '})',
  '',
].join('\n')

const VM_LEFT_SOURCE = [
  'export function add(left, right) {',
  '  return left + right',
  '}',
  '',
].join('\n')

const VM_LEFT_HELPER_SOURCE = 'export const offset = () => 0\n'

const VM_RIGHT_TEST = [
  "import { expect, test } from 'vitest'",
  "import { label } from '../src/right.mjs'",
  '',
  "test('labels', () => {",
  "  expect(label()).toBe('leftright')",
  '})',
  '',
].join('\n')

const VM_RIGHT_SOURCE = [
  'export function label() {',
  "  return 'left' + 'right'",
  '}',
  '',
].join('\n')

const VM_TOUCHING_TEST = [
  "import { test } from 'vitest'",
  "import { add } from '../src/target.mjs'",
  '',
  "test('touches add', () => {",
  '  add(1, 2)',
  '})',
  '',
].join('\n')

const VM_ADDING_TEST = [
  "import { expect, test } from 'vitest'",
  "import { add } from '../src/target.mjs'",
  '',
  "test('adds two numbers', () => {",
  '  expect(add(1, 2)).toBe(3)',
  '})',
  '',
].join('\n')

const VM_REACH_LEFT_SOURCE = [
  "import { offset } from './left-helper.mjs'",
  '',
  'export const base = 1 + 1',
  'export const shifted = () => base + offset()',
  '',
].join('\n')

const VM_REACH_LEFT_HELPER_SOURCE = 'export const offset = () => 0\n'

const VM_REACH_LEFT_TEST = [
  "import { expect, test } from 'vitest'",
  "import { base } from '../src/left.mjs'",
  '',
  "test('the module-level base is two', () => {",
  '  expect(base).toBe(2)',
  '})',
  '',
].join('\n')

const VM_REACH_RIGHT_SOURCE = [
  'export function label() {',
  "  return 'left' + 'right'",
  '}',
  '',
].join('\n')

const VM_REACH_RIGHT_TEST = [
  "import { expect, test } from 'vitest'",
  "import { label } from '../src/right.mjs'",
  '',
  "test('labels', () => {",
  "  expect(label()).toBe('leftright')",
  '})',
  '',
].join('\n')

const VM_REACH_LOADER_TEST = [
  "import { expect, test } from 'vitest'",
  '',
  'const load = (name) => import(name)',
  '',
  "test('exposes a loader whose specifier cannot be traced', () => {",
  "  expect(typeof load).toBe('function')",
  '})',
  '',
].join('\n')

const VM_UNREACHED_SOURCE = 'export const untouched = () => 0\n'

const writeVmFixture = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* writeFixture(files)
    yield* fs.makeDirectory(path.join(root, 'node_modules'), { recursive: true })
    const installed = yield* fs.readDirectory(path.join(PACKAGE_ROOT, 'node_modules'))
    yield* Effect.forEach(
      installed,
      (entry) =>
        Effect.gen(function*() {
          const target = path.join(root, 'node_modules', entry)
          const present = yield* fs.exists(target)
          yield* Effect.when(
            fs.symlink(path.join(PACKAGE_ROOT, 'node_modules', entry), target),
            Effect.succeed(!present),
          )
        }),
      { discard: true },
    )
    return root
  }).pipe(Effect.orDie)

const vmOptionsOf = (
  root: string,
  extras: Partial<Options.PartialStrykerOptions> = {},
): Options.PartialStrykerOptions => ({
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.js'],
  reporters: [],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
  ...extras,
})

interface CostedMutant {
  readonly id: string
  readonly status: string
  readonly static: boolean
  readonly testsExecuted: number
}

const costedMutantsOf = (events: ReadonlyArray<RunEvent.RunEvent>): readonly CostedMutant[] =>
  events.flatMap((event) =>
    S.is(RunEvent.RunMutantTestedEvent)(event)
      ? [{
        id: event.id,
        status: event.status,
        static: event.static,
        testsExecuted: event.cost?.testsExecuted ?? 0,
      }]
      : []
  )

const SEMANTICS_BUMPED = 0

const withSemanticsBumped = (text: string): string =>
  Option.getOrElse(
    Option.flatMap(
      S.decodeOption(S.fromJsonString(S.Record(S.String, S.Unknown)))(text),
      (report) =>
        S.encodeOption(S.fromJsonString(S.Record(S.String, S.Unknown)))({
          ...report,
          verdictSemanticsVersion: SEMANTICS_BUMPED,
        }),
    ),
    () => text,
  )

const killerNamesOf = (text: string, mutantIds: ReadonlySet<string>): readonly string[] =>
  Option.getOrElse(
    Option.map(S.decodeOption(S.fromJsonString(Engine.IncrementalReportSchema))(text), (report) => {
      const testFiles = report.testFiles ?? {}
      const runnerIdByPosition = Object.fromEntries(
        Object.entries(testFiles).flatMap(([file, entry]) =>
          entry.tests.map((test) => [test.id, `${file}#${test.name}`] as const)
        ),
      )
      return Object.values(report.files)
        .flatMap((file) => file.mutants)
        .filter((mutant) => mutantIds.has(mutant.id))
        .flatMap((mutant) => [...(mutant.killedBy ?? [])])
        .map((id) => runnerIdByPosition[id] ?? id)
    }),
    (): readonly string[] => [],
  )

const statusesOf = (mutants: readonly RecordedMutant[]): readonly string[] =>
  [...mutants].sort((left, right) => left.id.localeCompare(right.id)).map((mutant) => `${mutant.id}:${mutant.status}`)

const reportKeysOf = <A>(record: Readonly<Record<string, A>> | undefined): readonly string[] =>
  Option.match(Option.fromNullishOr(record), {
    onNone: (): readonly string[] => [],
    onSome: (present) => Object.keys(present),
  })

const statusMapOf = (mutants: readonly RecordedMutant[]): ReadonlyMap<string, string> =>
  new Map(mutants.map((mutant) => [mutant.id, mutant.status]))

const flippedToKilled = (
  firstStatuses: ReadonlyMap<string, string>,
  secondStatuses: ReadonlyMap<string, string>,
): boolean => [...firstStatuses].some(([id, status]) => status === 'Survived' && secondStatuses.get(id) === 'Killed')

const survivedAfterKilled = (
  firstStatuses: ReadonlyMap<string, string>,
  secondStatuses: ReadonlyMap<string, string>,
): boolean => [...secondStatuses].some(([id, status]) => status === 'Survived' && firstStatuses.get(id) === 'Killed')

interface ReuseVariation {
  readonly first: RunObservation
  readonly second: RunObservation
}

const NEW_TEST_MEASURED = {
  newTestDiscovered: true,
  newTestCovered: true,
  dryRunDigestMoved: true,
  flippedToKilled: true,
  noVerdictRegressed: true,
}

const newTestOutcomeOf = (variation: ReuseVariation) => {
  const report = reusableReportOf(variation.second.incrementalText)
  const firstReport = reusableReportOf(variation.first.incrementalText)
  const coverageFiles = reportKeysOf(report?.dryRunCoverage?.mutantCoverage?.perTest).map(fileOfCoverageKey)
  const firstStatuses = statusMapOf(variation.first.mutants)
  const secondStatuses = statusMapOf(variation.second.mutants)
  return {
    newTestDiscovered: reportKeysOf(report?.testFiles).includes('test/second.test.mjs'),
    newTestCovered: coverageFiles.includes('test/second.test.mjs'),
    dryRunDigestMoved: firstReport?.dryRunCoverage?.testClosureDigest !== undefined &&
      firstReport.dryRunCoverage.testClosureDigest !== report?.dryRunCoverage?.testClosureDigest,
    flippedToKilled: flippedToKilled(firstStatuses, secondStatuses),
    noVerdictRegressed: !survivedAfterKilled(firstStatuses, secondStatuses),
  }
}

Feature('Content-keyed reuse across incremental reports')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine over the host filesystem, so report I/O is the real one')
  .body(({ scenario }) => {
    scenario(
      'A second run with no change reuses every verdict and reports zero refusals',
      Gherkin.Do.pipe(
        Given('a workspace whose source file is mutated by a command runner')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = optionsOf(root)
                  const first = yield* runOnce(root, options)
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.provide(filePorts)),
        ),
        Then('the first run runs everything and the second reuses everything with no refusal')((s, expect) => {
          const planned = s.fixture.first.mutants.length
          return expect({
            runSucceeded: Exit.isSuccess(s.fixture.second.exit),
            plannedNonZero: planned > 0,
            first: {
              reused: s.fixture.first.reuse?.reused,
              ran: s.fixture.first.reuse?.ran,
              refused: s.fixture.first.reuse?.refused,
            },
            second: {
              reused: s.fixture.second.reuse?.reused,
              ran: s.fixture.second.reuse?.ran,
              refused: s.fixture.second.reuse?.refused,
            },
            statusesStable: statusesOf(s.fixture.first.mutants).join(',') ===
              statusesOf(s.fixture.second.mutants).join(','),
            everyMutantCarriesAClosureDigest: s.fixture.first.incrementalText.split('"closureDigest"').length - 1 ===
              planned,
          }).toEqual({
            runSucceeded: true,
            plannedNonZero: true,
            first: { reused: 0, ran: planned, refused: { ...ZERO_REFUSALS, noPriorRecord: planned } },
            second: { reused: planned, ran: 0, refused: ZERO_REFUSALS },
            statusesStable: true,
            everyMutantCarriesAClosureDigest: true,
          })
        }),
      ),
    )

    scenario(
      'A first repeat run under default ignore patterns reuses every verdict',
      Gherkin.Do.pipe(
        Given('a workspace configured with no ignore patterns of its own')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = optionsOf(root, { ignorePatterns: [] })
                  const first = yield* runOnce(root, options)
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.provide(filePorts)),
        ),
        Then('the second run reuses every verdict although the first run wrote reports into the project')(
          (s, expect) => {
            const planned = s.fixture.first.mutants.length
            return expect({
              runSucceeded: Exit.isSuccess(s.fixture.second.exit),
              plannedNonZero: planned > 0,
              second: {
                reused: s.fixture.second.reuse?.reused,
                ran: s.fixture.second.reuse?.ran,
                refused: s.fixture.second.reuse?.refused,
              },
            }).toEqual({
              runSucceeded: true,
              plannedNonZero: true,
              second: { reused: planned, ran: 0, refused: ZERO_REFUSALS },
            })
          },
        ),
      ),
    )

    scenario(
      'A second run with no change skips the dry run instead of spawning the test runner again',
      Gherkin.Do.pipe(
        Given('a workspace whose command runner appends every spawn to a log file')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              const spawnLog = yield* fs.makeTempFile({ prefix: 'runner-spawns', suffix: '.txt' })
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = optionsOf(root, {
                    commandRunner: { command: `echo spawned >> ${spawnLog}` },
                  })
                  const first = yield* runOnce(root, options)
                  const spawnsAfterFirst = yield* lineCountOf(spawnLog)
                  const second = yield* runOnce(root, options)
                  const spawnsAfterSecond = yield* lineCountOf(spawnLog)
                  return {
                    planned: first.mutants.length,
                    first,
                    second,
                    spawnsInFirstRun: spawnsAfterFirst,
                    spawnsInSecondRun: spawnsAfterSecond - spawnsAfterFirst,
                  }
                }),
                Effect.andThen(removeFixture(root), Effect.orDie(fs.remove(spawnLog, { force: true }))),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the second run spawns no test runner and still reports every phase duration')((s, expect) =>
          expect({
            plannedNonZero: s.fixture.planned > 0,
            firstRunSpawned: s.fixture.spawnsInFirstRun > 0,
            second: {
              reused: s.fixture.second.reuse?.reused,
              ran: s.fixture.second.reuse?.ran,
              refused: s.fixture.second.reuse?.refused,
            },
            spawnsInSecondRun: s.fixture.spawnsInSecondRun,
            secondRunDryRunPhase: typeof s.fixture.second.verdict?.phaseDurations?.['dry-run'],
          }).toEqual({
            plannedNonZero: true,
            firstRunSpawned: true,
            second: { reused: s.fixture.planned, ran: 0, refused: ZERO_REFUSALS },
            spawnsInSecondRun: 0,
            secondRunDryRunPhase: 'number',
          })
        ),
      ),
    )

    scenario(
      'A verdict written under another report path is reused through the incrementalSources globs',
      Gherkin.Do.pipe(
        Given('a workspace whose incremental report has been relocated to a shard path')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = optionsOf(root, { incrementalSources: ['reports/shard-*.json'] })
                  const first = yield* runOnce(root, options)
                  yield* fs.rename(
                    path.join(root, 'reports', 'main.json'),
                    path.join(root, 'reports', 'shard-1.json'),
                  )
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the second run reuses the relocated shard report instead of running the mutants again')((s, expect) =>
          expect({
            second: {
              reused: s.fixture.second.reuse?.reused,
              ran: s.fixture.second.reuse?.ran,
              refused: s.fixture.second.reuse?.refused,
            },
            relocatedReportReused: (s.fixture.second.reuse?.reused ?? 0) > 0,
            firstRanEverything: s.fixture.first.reuse?.reused === 0,
          }).toEqual({
            second: { reused: s.fixture.second.mutants.length, ran: 0, refused: ZERO_REFUSALS },
            relocatedReportReused: true,
            firstRanEverything: true,
          })
        ),
      ),
    )

    scenario(
      'A whole-suite mutant is refused when a project file outside its covering set changes',
      Gherkin.Do.pipe(
        Given('a workspace whose mutants run the whole suite and a type-only project file changes in place')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeFixture([
                ['src/math.ts', SOURCE],
                ['src/types.ts', 'export type Thing = { readonly name: string }\n'],
              ])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = optionsOf(root)
                  const first = yield* runOnce(root, options)
                  yield* fs.writeFileString(
                    path.join(root, 'src', 'types.ts'),
                    'export type Thing = { readonly label: string }\n',
                  )
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the second run refuses every prior verdict with closureChanged instead of reusing it')((s, expect) => {
          const planned = s.fixture.first.mutants.length
          return expect({
            plannedNonZero: planned > 0,
            mutantSetUnchanged: statusesOf(s.fixture.first.mutants).join(',') ===
              statusesOf(s.fixture.second.mutants).join(','),
            second: {
              reused: s.fixture.second.reuse?.reused,
              ran: s.fixture.second.reuse?.ran,
              refused: s.fixture.second.reuse?.refused,
            },
          }).toEqual({
            plannedNonZero: true,
            mutantSetUnchanged: true,
            second: { reused: 0, ran: planned, refused: { ...ZERO_REFUSALS, closureChanged: planned } },
          })
        }),
      ),
    )

    scenario(
      'A refused re-run starts a mutant with its previous killing test',
      Gherkin.Do.pipe(
        Given('a workspace whose mutant is covered by a passing test and killed by a slower one')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeVmFixture([
                ['package.json', VM_PACKAGE_SOURCE],
                ['src/math.js', VM_MATH_SOURCE],
                ['src/other.js', VM_OTHER_SOURCE],
                ['test/passing.test.mjs', VM_PASSING_TEST],
                ['test/killing.test.mjs', VM_KILLING_TEST],
              ])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = vmOptionsOf(root)
                  const incrementalFile = path.join(root, 'reports', 'main.json')
                  const first = yield* runOnce(root, options)
                  yield* fs.writeFileString(
                    incrementalFile,
                    withSemanticsBumped(yield* fs.readFileString(incrementalFile)),
                  )
                  const second = yield* runOnce(root, options)
                  yield* fs.writeFileString(path.join(root, 'test', 'aaa-other.test.mjs'), VM_OTHER_TEST)
                  const third = yield* runOnce(root, options)
                  return { first, second, third }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the second run runs the previous killer first, and every run names it as the killer')((s, expect) => {
          const planned = s.fixture.first.mutants.length
          const performedTestsOf = (events: ReadonlyArray<RunEvent.RunEvent>) =>
            Object.fromEntries(
              costedMutantsOf(events)
                .filter((mutant) => mutant.status === 'Killed' && !mutant.static)
                .map((mutant) => [mutant.id, mutant.testsExecuted] as const),
            )
          const firstPerformed = performedTestsOf(s.fixture.first.events)
          const secondPerformed = performedTestsOf(s.fixture.second.events)
          const coveredByMoreThanOneTest = Object.keys(firstPerformed).filter(
            (id) => (firstPerformed[id] ?? 0) > 1,
          )
          const killedIds = new Set(
            s.fixture.first.mutants.filter((mutant) => mutant.status === 'Killed').map((mutant) => mutant.id),
          )
          const statusesOfKilled = (mutants: readonly RecordedMutant[]) =>
            statusesOf(mutants.filter((mutant) => killedIds.has(mutant.id)))
          const killerNames = killerNamesOf(s.fixture.third.incrementalText, killedIds)
          return expect({
            runSucceeded: Exit.isSuccess(s.fixture.second.exit),
            thirdRunSucceeded: Exit.isSuccess(s.fixture.third.exit),
            plannedNonZero: planned > 0,
            someKilledMutantCoveredByMoreThanOneTest: coveredByMoreThanOneTest.length > 0,
            second: {
              reused: s.fixture.second.reuse?.reused,
              ran: s.fixture.second.reuse?.ran,
              refused: s.fixture.second.reuse?.refused,
            },
            secondRunPlannedTheKillerFirst: coveredByMoreThanOneTest.every(
              (id) => secondPerformed[id] === 1,
            ),
            killedVerdictsStableAcrossAddedTests: killedIds.size > 0 &&
              statusesOfKilled(s.fixture.first.mutants).join(',') ===
                statusesOfKilled(s.fixture.third.mutants).join(','),
            thirdRunReusedAVerdict: (s.fixture.third.reuse?.reused ?? 0) > 0,
            everyReportedKillerIsTheKillingTest: killerNames.length === killedIds.size &&
              killerNames.every((name) => name.endsWith('#adds two numbers')),
          }).toEqual({
            runSucceeded: true,
            thirdRunSucceeded: true,
            plannedNonZero: true,
            someKilledMutantCoveredByMoreThanOneTest: true,
            second: { reused: 0, ran: planned, refused: { ...ZERO_REFUSALS, semanticsChanged: planned } },
            secondRunPlannedTheKillerFirst: true,
            killedVerdictsStableAcrossAddedTests: true,
            thirdRunReusedAVerdict: true,
            everyReportedKillerIsTheKillingTest: true,
          })
        }),
      ),
    )

    scenario(
      'A change to a helper only one covering test reaches re-runs only that test set',
      Gherkin.Do.pipe(
        Given('a workspace whose two mutated files are covered by different test files')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeVmFixture([
                ['package.json', '{ "type": "module" }\n'],
                ['src/left.mjs', VM_LEFT_SOURCE],
                ['src/right.mjs', VM_RIGHT_SOURCE],
                ['test/left-helper.mjs', VM_LEFT_HELPER_SOURCE],
                ['test/left.test.mjs', VM_LEFT_TEST],
                ['test/right.test.mjs', VM_RIGHT_TEST],
              ])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = vmOptionsOf(root, { testFiles: [], mutate: ['src/**/*.mjs'] })
                  const first = yield* runOnce(root, options)
                  yield* fs.writeFileString(
                    path.join(root, 'test', 'left-helper.mjs'),
                    `${VM_LEFT_HELPER_SOURCE}// a comment\n`,
                  )
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.provide(filePorts)),
        ),
        Then('only mutants whose covering tests reach the changed helper are refused')((s, expect) => {
          const firstReport = reusableReportOf(s.fixture.first.incrementalText)
          const secondReport = reusableReportOf(s.fixture.second.incrementalText)
          const secondMutants = secondReport === undefined
            ? []
            : Object.values(secondReport.files).flatMap((file) => file.mutants)
          const firstById = new Map(s.fixture.first.mutants.map((mutant) => [mutant.id, mutant.status]))
          const secondById = new Map(secondMutants.map((mutant) => [mutant.id, mutant.status]))
          const mutantIds = firstReport === undefined
            ? []
            : [...mutantIdsInOf(firstReport, 'src/left.mjs'), ...mutantIdsInOf(firstReport, 'src/right.mjs')]
          const staticIds = firstReport === undefined ? new Set<string>() : staticIdsOf(firstReport)
          const changed = (mutantId: string): boolean =>
            firstReport !== undefined &&
            (staticIds.has(mutantId) || coveringFilesOf(firstReport, mutantId).has('test/left.test.mjs'))
          const expectedReused = mutantIds.filter((mutantId) => !changed(mutantId))
          const expectedRefused = mutantIds.filter(changed)
          const reuse = s.fixture.second.reuse
          const closureRefused = reuse?.refused.closureChanged ?? 0
          const keptOrUnremembered = (reuse?.reused ?? 0) + (reuse?.refused.noPriorRecord ?? 0)
          const refusedForOtherReasons = [
            reuse?.refused.semanticsChanged,
            reuse?.refused.policyChanged,
            reuse?.refused.runInputsChanged,
            reuse?.refused.flakyDependency,
            reuse?.refused.timeoutUnreproduced,
          ].reduce<number>((total, count) => total + (count ?? 0), 0)
          return expect({
            runSucceeded: Exit.isSuccess(s.fixture.first.exit),
            secondRunSucceeded: Exit.isSuccess(s.fixture.second.exit),
            plannedNonZero: mutantIds.length > 0,
            bothOutcomesPresent: expectedReused.length > 0 && expectedRefused.length > 0,
            closureRefused,
            keptOrUnremembered,
            refusedForOtherReasons,
            statusesStable: mutantIds.length === secondById.size &&
              mutantIds.every((mutantId) => firstById.get(mutantId) === secondById.get(mutantId)),
          }).toEqual({
            runSucceeded: true,
            secondRunSucceeded: true,
            plannedNonZero: true,
            bothOutcomesPresent: true,
            closureRefused: expectedRefused.length,
            keptOrUnremembered: expectedReused.length,
            refusedForOtherReasons: 0,
            statusesStable: true,
          })
        }),
      ),
    )

    scenario(
      'A test file the runner discovers under a configured test glob is measured before any verdict is reused',
      Gherkin.Do.pipe(
        Given('a workspace whose test glob will match a test file added between two runs')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeVmFixture([
                ['package.json', '{ "type": "module" }\n'],
                ['src/target.mjs', VM_LEFT_SOURCE],
                ['test/first.test.mjs', VM_TOUCHING_TEST],
              ])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = vmOptionsOf(root, { mutate: ['src/**/*.mjs'] })
                  const first = yield* runOnce(root, options)
                  yield* fs.writeFileString(path.join(root, 'test', 'second.test.mjs'), VM_ADDING_TEST)
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.provide(filePorts)),
        ),
        Then('the second run measures the discovered test and reaches its verdicts')((s, expect) =>
          expect({
            runSucceeded: Exit.isSuccess(s.fixture.first.exit) && Exit.isSuccess(s.fixture.second.exit),
            measured: newTestOutcomeOf(s.fixture),
          }).toEqual({ runSucceeded: true, measured: NEW_TEST_MEASURED })
        ),
      ),
    )

    scenario(
      'A test file the runner discovers without a configured test list is measured before any verdict is reused',
      Gherkin.Do.pipe(
        Given('a workspace that lets the runner discover every test file')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeVmFixture([
                ['package.json', '{ "type": "module" }\n'],
                ['src/target.mjs', VM_LEFT_SOURCE],
                ['test/first.test.mjs', VM_TOUCHING_TEST],
              ])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = vmOptionsOf(root, { testFiles: [], mutate: ['src/**/*.mjs'] })
                  const first = yield* runOnce(root, options)
                  yield* fs.writeFileString(path.join(root, 'test', 'second.test.mjs'), VM_ADDING_TEST)
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.provide(filePorts)),
        ),
        Then('the second run measures the discovered test and reaches its verdicts')((s, expect) =>
          expect({
            runSucceeded: Exit.isSuccess(s.fixture.first.exit) && Exit.isSuccess(s.fixture.second.exit),
            measured: newTestOutcomeOf(s.fixture),
          }).toEqual({ runSucceeded: true, measured: NEW_TEST_MEASURED })
        ),
      ),
    )

    scenario(
      'A module-level mutant keeps its verdict while an edit stays outside every test closure',
      Gherkin.Do.pipe(
        Given('a workspace whose module-level mutant sits beside a source file no test imports')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeVmFixture([
                ['package.json', '{ "type": "module" }\n'],
                ['src/left.mjs', VM_REACH_LEFT_SOURCE],
                ['src/left-helper.mjs', VM_REACH_LEFT_HELPER_SOURCE],
                ['src/right.mjs', VM_REACH_RIGHT_SOURCE],
                ['src/unreached.mjs', VM_UNREACHED_SOURCE],
                ['test/left.test.mjs', VM_REACH_LEFT_TEST],
                ['test/right.test.mjs', VM_REACH_RIGHT_TEST],
              ])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = vmOptionsOf(root, { mutate: ['src/**/*.mjs'] })
                  const first = yield* runOnce(root, options)
                  yield* fs.writeFileString(
                    path.join(root, 'src', 'unreached.mjs'),
                    `${VM_UNREACHED_SOURCE}// an edit no test closure reaches\n`,
                  )
                  const afterUnrelatedEdit = yield* runOnce(root, options)
                  yield* fs.writeFileString(
                    path.join(root, 'src', 'left-helper.mjs'),
                    `${VM_REACH_LEFT_HELPER_SOURCE}// an edit inside the reaching closure\n`,
                  )
                  const afterReachingEdit = yield* runOnce(root, options)
                  return { first, afterUnrelatedEdit, afterReachingEdit }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.provide(filePorts)),
        ),
        Then('the module-level mutants survive the unreached edit and re-run when their reaching closure changes')(
          (s, expect) => {
            const firstReport = reusableReportOf(s.fixture.first.incrementalText)
            const staticIds = firstReport === undefined ? new Set<string>() : staticIdsOf(firstReport)
            const leftStaticIds = firstReport === undefined
              ? []
              : mutantIdsInOf(firstReport, 'src/left.mjs').filter((id) => staticIds.has(id))
            const reusedIdsOf = (observation: RunObservation): ReadonlySet<string> =>
              new Set(
                observation.mutants
                  .filter((mutant) => mutant.statusReason === 'Remembered')
                  .map((mutant) => mutant.id),
              )
            const firstStatuses = statusMapOf(s.fixture.first.mutants)
            const unrelatedReused = reusedIdsOf(s.fixture.afterUnrelatedEdit)
            const unrelatedStatuses = statusMapOf(s.fixture.afterUnrelatedEdit.mutants)
            const reachingReused = reusedIdsOf(s.fixture.afterReachingEdit)
            const reachingStatuses = statusMapOf(s.fixture.afterReachingEdit.mutants)
            return expect({
              runSucceeded: [s.fixture.first, s.fixture.afterUnrelatedEdit, s.fixture.afterReachingEdit]
                .every((observation) => Exit.isSuccess(observation.exit)),
              leftStaticMutantsPositive: leftStaticIds.length > 0,
              keptOnUnreachedEdit: leftStaticIds.length > 0 &&
                leftStaticIds.every((id) =>
                  unrelatedReused.has(id) && unrelatedStatuses.get(id) === firstStatuses.get(id)
                ),
              reranOnReachingEdit: leftStaticIds.length > 0 &&
                leftStaticIds.every((id) =>
                  !reachingReused.has(id) && reachingStatuses.get(id) === firstStatuses.get(id)
                ),
            }).toEqual({
              runSucceeded: true,
              leftStaticMutantsPositive: true,
              keptOnUnreachedEdit: true,
              reranOnReachingEdit: true,
            })
          },
        ),
      ),
    )

    scenario(
      'An edit outside every closed closure re-runs a module-level mutant when a test file cannot trace all of its imports',
      Gherkin.Do.pipe(
        Given('a workspace whose untraceable loader test sits beside two independent source and test pairs')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeVmFixture([
                ['package.json', '{ "type": "module" }\n'],
                ['src/left.mjs', VM_REACH_LEFT_SOURCE],
                ['src/left-helper.mjs', VM_REACH_LEFT_HELPER_SOURCE],
                ['src/right.mjs', VM_REACH_RIGHT_SOURCE],
                ['src/unreached.mjs', VM_UNREACHED_SOURCE],
                ['test/left.test.mjs', VM_REACH_LEFT_TEST],
                ['test/right.test.mjs', VM_REACH_RIGHT_TEST],
                ['test/loader.test.mjs', VM_REACH_LOADER_TEST],
              ])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = vmOptionsOf(root, { mutate: ['src/**/*.mjs'] })
                  const first = yield* runOnce(root, options)
                  yield* fs.writeFileString(
                    path.join(root, 'src', 'unreached.mjs'),
                    `${VM_UNREACHED_SOURCE}// an edit no closed closure reaches\n`,
                  )
                  const afterUnrelatedEdit = yield* runOnce(root, options)
                  return { first, afterUnrelatedEdit }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.provide(filePorts)),
        ),
        Then('the module-level mutants re-run because the untraceable test could load their file')(
          (s, expect) => {
            const firstReport = reusableReportOf(s.fixture.first.incrementalText)
            const staticIds = firstReport === undefined ? new Set<string>() : staticIdsOf(firstReport)
            const leftStaticIds = firstReport === undefined
              ? []
              : mutantIdsInOf(firstReport, 'src/left.mjs').filter((id) => staticIds.has(id))
            const reusedIdsOf = (observation: RunObservation): ReadonlySet<string> =>
              new Set(
                observation.mutants
                  .filter((mutant) => mutant.statusReason === 'Remembered')
                  .map((mutant) => mutant.id),
              )
            const firstStatuses = statusMapOf(s.fixture.first.mutants)
            const reusedAfterUnrelatedEdit = reusedIdsOf(s.fixture.afterUnrelatedEdit)
            const statusesAfterUnrelatedEdit = statusMapOf(s.fixture.afterUnrelatedEdit.mutants)
            return expect({
              runSucceeded: Exit.isSuccess(s.fixture.first.exit) &&
                Exit.isSuccess(s.fixture.afterUnrelatedEdit.exit),
              leftStaticMutantsPositive: leftStaticIds.length > 0,
              reranOnUnrelatedEdit: leftStaticIds.length > 0 &&
                leftStaticIds.every((id) =>
                  !reusedAfterUnrelatedEdit.has(id) &&
                  statusesAfterUnrelatedEdit.get(id) === firstStatuses.get(id)
                ),
            }).toEqual({
              runSucceeded: true,
              leftStaticMutantsPositive: true,
              reranOnUnrelatedEdit: true,
            })
          },
        ),
      ),
    )
  })
