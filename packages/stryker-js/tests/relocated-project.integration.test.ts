import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import {
  copyProject,
  exitOf,
  INCREMENTAL_FILE,
  jsProjectFiles,
  logFile,
  RELEASED_CLI,
  runCli,
  runCounted,
  scoredMutantsOf,
  scratchDirectory,
  statusesOf,
  writeFiles,
  writeProject,
} from './__fixtures__/cli-project.fixture.js'

const Feature = makeFeature({ it })

const SOURCES_FILE = 'reports/elsewhere.json'

const TS_PROJECT = [
  ['package.json', '{ "type": "module" }\n'],
  [
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      include: ['src'],
    }),
  ],
  [
    'stryker.config.mjs',
    `export default {
  testRunner: 'vm',
  testFiles: ['test/size.vm.test.ts'],
  checkers: [{ plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker') }],
  plugins: [],
  reporters: ['json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  mutate: ['src/size.ts'],
  coverageAnalysis: 'perTest',
  cleanTempDir: 'always',
  thresholds: { high: 80, low: 60, break: null },
  incremental: true,
  incrementalFile: '${INCREMENTAL_FILE}',
}
`,
  ],
  [
    'src/size.ts',
    [
      'export interface Sized {',
      '  readonly size: number',
      '}',
      '',
      'export const base: Sized = { size: 2 }',
      '',
      'export const doubled = (sized: Sized): number => sized.size * 2',
      '',
    ].join('\n'),
  ],
  [
    'test/size.vm.test.ts',
    [
      "import { expect, test } from 'vitest'",
      '',
      "import { base, doubled } from '../src/size.js'",
      '',
      "test('doubles the base size', () => {",
      '  expect(doubled(base)).toBe(4)',
      '})',
      '',
    ].join('\n'),
  ],
] as const

const planOf = (root: string, out: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const run = yield* runCli({ root, args: ['plan', '--target-seconds', '1', '--max-shards', '4', '--out', out] })
    return { ...run, plan: yield* fs.readFileString(out).pipe(Effect.orElseSucceed(() => '')) }
  })

Feature('Running mutation testing on a project that was run under another root')
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs real projects in temporary directories')
  .body(({ scenario }) => {
    scenario(
      'A project copied to another root with its reports scores its mutants as the run at the first root did',
      Gherkin.Do.pipe(
        Given('a project run at root A, then copied with its reports to root B and run there')(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const log = yield* logFile
              const rootA = yield* writeProject(jsProjectFiles({ log }))
              const first = yield* runCounted({ root: rootA, log, args: ['run'] })
              const rootB = yield* copyProject(rootA)
              const second = yield* runCounted({ root: rootB, log, args: ['run'] })
              const roots = yield* Effect.orDie(Effect.all([fs.realPath(rootA), fs.realPath(rootB)]))
              return { first, second, roots }
            })),
        ),
        Then('root B scores every mutant as root A did, and its output names the refusal and both roots')((s, expect) =>
          expect({
            exits: [exitOf(s.observed.first), exitOf(s.observed.second)],
            firstStatuses: statusesOf(s.observed.first.scored),
            secondScored: s.observed.second.scored,
            namesRefusal: s.observed.second.output.includes('dry-run coverage reuse refused (rootChanged)'),
            namesBothRoots: s.observed.roots.map((root) => s.observed.second.output.includes(root)),
          }).toEqual({
            exits: [0, 0],
            firstStatuses: ['Killed', 'NoCoverage'],
            secondScored: s.observed.first.scored,
            namesRefusal: true,
            namesBothRoots: [true, true],
          })
        ),
      ),
    )

    scenario(
      'A shard plan at another root does not depend on the reports copied from the first root',
      Gherkin.Do.pipe(
        Given("a project run at root A and copied to root B, planned with A's reports and again without them")(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const log = yield* logFile
              const rootA = yield* writeProject(jsProjectFiles({ log }))
              const first = yield* runCounted({ root: rootA, log, args: ['run'] })
              const rootB = yield* copyProject(rootA)
              const outside = yield* scratchDirectory
              const withReports = yield* planOf(rootB, path.join(outside, 'with-reports.json'))
              yield* Effect.orDie(fs.remove(path.join(rootB, 'reports'), { recursive: true }))
              const withoutReports = yield* planOf(rootB, path.join(outside, 'without-reports.json'))
              return { first, withReports, withoutReports }
            })),
        ),
        Then('both plans are the same plan')((s, expect) =>
          expect({
            exits: [exitOf(s.observed.first), exitOf(s.observed.withReports), exitOf(s.observed.withoutReports)],
            planned: s.observed.withoutReports.plan.length > 0,
            withReports: s.observed.withReports.plan,
          }).toEqual({ exits: [0, 0, 0], planned: true, withReports: s.observed.withoutReports.plan })
        ),
      ),
    )

    scenario(
      'A project holding its own report and one restored from another root re-executes nothing and plans as before the restore',
      Gherkin.Do.pipe(
        Given("root B run once, then root A's report restored into B through incrementalSources")(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const sources = `  incrementalSources: ['${SOURCES_FILE}'],\n  ignorePatterns: ['${SOURCES_FILE}'],\n`
              const logA = yield* logFile
              const logB = yield* logFile
              const rootA = yield* writeProject(jsProjectFiles({ log: logA }))
              const rootB = yield* writeProject(jsProjectFiles({ log: logB, configExtras: sources }))
              const ownRun = yield* runCounted({ root: rootB, log: logB, args: ['run'] })
              const outside = yield* scratchDirectory
              const ownPlan = yield* planOf(rootB, path.join(outside, 'own.json'))
              const otherRun = yield* runCounted({ root: rootA, log: logA, args: ['run'] })
              const restored = yield* Effect.orDie(fs.readFileString(path.join(rootA, INCREMENTAL_FILE)))
              yield* writeFiles(rootB, [[SOURCES_FILE, restored]])
              const restoredPlan = yield* planOf(rootB, path.join(outside, 'restored.json'))
              const rerun = yield* runCounted({ root: rootB, log: logB, args: ['run'] })
              return { ownRun, ownPlan, otherRun, restoredPlan, rerun }
            })),
        ),
        Then(
          "B's re-run executes no test, scores as its first run and says it skipped the other root's report, and its plan is unchanged by the restore",
        )(
          (s, expect) =>
            expect({
              exits: [
                s.observed.ownRun,
                s.observed.ownPlan,
                s.observed.otherRun,
                s.observed.restoredPlan,
                s.observed.rerun,
              ].map(exitOf),
              ownRunStatuses: statusesOf(s.observed.ownRun.scored),
              rerunExecutions: s.observed.rerun.executions,
              rerunScored: s.observed.rerun.scored,
              rerunNamesSkippedReport: s.observed.rerun.output.includes(
                'Skipped saved dry-run coverage: 1 recorded under another project root, 0 with no recorded root',
              ),
              restoredPlan: s.observed.restoredPlan.plan,
            }).toEqual({
              exits: [0, 0, 0, 0, 0],
              ownRunStatuses: ['Killed', 'NoCoverage'],
              rerunExecutions: 0,
              rerunScored: s.observed.ownRun.scored,
              rerunNamesSkippedReport: true,
              restoredPlan: s.observed.ownPlan.plan,
            }),
        ),
      ),
    )

    scenario(
      'A report written by the released version scores alike after the upgrade, and the run after that executes nothing',
      Gherkin.Do.pipe(
        Given('a project run by the released stryker, then twice by the built one')(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const log = yield* logFile
              const root = yield* writeProject(jsProjectFiles({ log }))
              const released = yield* runCounted({ root, log, args: ['run'], cli: RELEASED_CLI })
              const first = yield* runCounted({ root, log, args: ['run'] })
              const second = yield* runCounted({ root, log, args: ['run'] })
              return { released, first, second }
            })),
        ),
        Then('every run scores alike and the second upgraded run executes no test')((s, expect) =>
          expect({
            exits: [exitOf(s.observed.released), exitOf(s.observed.first), exitOf(s.observed.second)],
            releasedStatuses: statusesOf(s.observed.released.scored),
            scored: [s.observed.first.scored, s.observed.second.scored],
            secondExecutions: s.observed.second.executions,
          }).toEqual({
            exits: [0, 0, 0],
            releasedStatuses: ['Killed', 'NoCoverage'],
            scored: [s.observed.released.scored, s.observed.released.scored],
            secondExecutions: 0,
          })
        ),
      ),
    )

    scenario(
      'A rebuild that only rewrites a build log naming the project root re-executes nothing',
      Gherkin.Do.pipe(
        Given('a project whose build log is rewritten with a new wall-clock between two runs')(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const log = yield* logFile
              const root = yield* writeProject(jsProjectFiles({ log }))
              const buildLog = (millis: number) =>
                `$ pnpm run build\nconfig file: ${root}/tsdown.config.ts\nBuild complete in ${millis}ms\n`
              yield* writeFiles(root, [['.turbo/turbo-build.log', buildLog(1000)]])
              const first = yield* runCounted({ root, log, args: ['run'] })
              yield* writeFiles(root, [['.turbo/turbo-build.log', buildLog(2000)]])
              const second = yield* runCounted({ root, log, args: ['run'] })
              return { first, second }
            })),
        ),
        Then('the second run executes no test and scores as the first')((s, expect) =>
          expect({
            exits: [exitOf(s.observed.first), exitOf(s.observed.second)],
            firstStatuses: statusesOf(s.observed.first.scored),
            secondExecutions: s.observed.second.executions,
            secondScored: s.observed.second.scored,
          }).toEqual({
            exits: [0, 0],
            firstStatuses: ['Killed', 'NoCoverage'],
            secondExecutions: 0,
            secondScored: s.observed.first.scored,
          })
        ),
      ),
    )

    scenario(
      'A TypeScript project copied to another root scores its compile errors and kills as the run at the first root did',
      Gherkin.Do.pipe(
        Given(
          'a TypeScript project checked by the TypeScript checker at root A, then copied with its reports to root B',
        )(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const rootA = yield* writeProject(TS_PROJECT)
              const first = yield* runCli({ root: rootA, args: ['run'] })
              const firstScored = yield* scoredMutantsOf(rootA)
              const rootB = yield* copyProject(rootA)
              const second = yield* runCli({ root: rootB, args: ['run'] })
              return { first, firstScored, second, secondScored: yield* scoredMutantsOf(rootB) }
            })),
        ),
        Then('root B scores every mutant as root A did, compile errors included')((s, expect) =>
          expect({
            exits: [exitOf(s.observed.first), exitOf(s.observed.second)],
            firstStatuses: statusesOf(s.observed.firstScored),
            secondScored: s.observed.secondScored,
          }).toEqual({
            exits: [0, 0],
            firstStatuses: ['CompileError', 'Killed'],
            secondScored: s.observed.firstScored,
          })
        ),
      ),
    )
  })
