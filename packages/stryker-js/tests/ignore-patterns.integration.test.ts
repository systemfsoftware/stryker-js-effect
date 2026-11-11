import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'

import { type ProjectFiles, runCli, scratchDirectory, writeFiles } from './__fixtures__/cli-project.fixture.js'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)

const ALWAYS_IGNORED: ReadonlyArray<readonly [pattern: string, sample: string]> = [
  ['node_modules', 'node_modules/left-pad/index.js'],
  ['.git', '.git/HEAD'],
  ['*.tsbuildinfo', 'tsconfig.tsbuildinfo'],
  ['/stryker.log', 'stryker.log'],
  ['.next', '.next/server/page.js'],
  ['.nuxt', '.nuxt/app.js'],
  ['.svelte-kit', '.svelte-kit/output.js'],
  ['.turbo', '.turbo/cache.json'],
]

const WRITTEN_OUTPUTS = [
  'out/incremental.json',
  'out/stream.jsonl',
  'out/report.html',
  'out/report.json',
  'out/report.sarif',
  'reports/mutation/reproducers.json',
]

const UNWRITTEN_OUTPUTS = ['.stryker-scratch/leftover.txt', 'reports/mutation-stream.jsonl']

const NAMED_OUTPUTS = [
  '`tempDirName`',
  '`incrementalFile`',
  '`progressStreamFile`',
  '`reports/mutation-stream.jsonl`',
  '`htmlReporter.fileName`',
  '`jsonReporter.fileName`',
  'the SARIF file beside `jsonReporter.fileName`',
  '`reports/mutation/reproducers.json`',
]

const FOREIGN_REPORT = 'reports/coverage/lcov.info'

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  coverageAnalysis: 'off',
  mutate: ['src/**/*.ts'],
  checkers: [],
  reporters: ['html', 'json', 'sarif'],
  concurrency: 1,
  cleanTempDir: 'always',
  incremental: true,
  ignorePatterns: [],
  tempDirName: '.stryker-scratch',
  incrementalFile: 'out/incremental.json',
  progressStreamFile: 'out/stream.jsonl',
  htmlReporter: { fileName: 'out/report.html' },
  jsonReporter: { fileName: 'out/report.json' },
}
`

const PROJECT: ProjectFiles = [
  ['package.json', '{ "name": "ignore-consumer", "type": "module", "private": true }\n'],
  ['stryker.config.mjs', CONFIG],
  ['src/math.ts', 'export const add = (left: number, right: number): number => left + right\n'],
]

const ALWAYS_IGNORED_LIST = /always ignored: \[([^\]]*)\]/

const OUTPUT_LIST = /own output files are always excluded too: (.*?)\. Other files under `reports\/` are not ignored\./

const decodeWireLine = S.decodeOption(RunEvent.RunEventWireLine)

const eventsOf = (output: string): ReadonlyArray<RunEvent.RunEvent> =>
  output.split('\n').flatMap((line) => Option.toArray(decodeWireLine(line.trim())))

const placeholdersAt = (files: ReadonlyArray<string>): ProjectFiles => files.map((file) => [file, `${file}\n`])

const prepareProject: Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> = Effect.gen(
  function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* scratchDirectory
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* writeFiles(root, PROJECT)
    return root
  },
).pipe(Effect.orDie)

interface ReuseRun {
  readonly exitCode: number
  readonly reuse: RunEvent.ReuseReported | undefined
}

const reusedRun = (
  root: string,
): Effect.Effect<ReuseRun, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
  Effect.map(runCli({ root, args: ['run', '--json'] }), (run) => ({
    exitCode: run.exitCode,
    reuse: eventsOf(run.output).find((event) => S.is(RunEvent.ReuseReported)(event)),
  }))

const renderedHelp = Effect.scoped(
  Effect.gen(function*() {
    const root = yield* scratchDirectory
    const run = yield* runCli({ root, args: ['run', '--help', '--json'] })
    const text = eventsOf(run.output).filter((event) => S.is(RunEvent.HelpRendered)(event)).map((event) => event.help)
      .join('\n')
    return { exitCode: run.exitCode, text }
  }),
)

Feature('What Stryker always leaves out of a project', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a real project on the host filesystem')
  .body(({ scenario }) => {
    scenario(
      'Every always-ignored pattern and every output stays out of the project while other files under reports/ do not',
      Gherkin.Do.pipe(
        Given(
          'a project with no ignore patterns of its own and its outputs moved, run once, then given files under each pattern and at each output it did not write',
        )('runs', () =>
          Effect.scoped(
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* prepareProject
              const first = yield* reusedRun(root)
              const outputsWritten = yield* Effect.forEach(WRITTEN_OUTPUTS, (file) => fs.exists(path.join(root, file)))
                .pipe(Effect.orDie)
              yield* writeFiles(
                root,
                placeholdersAt([...ALWAYS_IGNORED.map(([, sample]) => sample), ...UNWRITTEN_OUTPUTS]),
              )
              const afterIgnored = yield* reusedRun(root)
              yield* writeFiles(root, placeholdersAt([FOREIGN_REPORT]))
              const afterForeignReport = yield* reusedRun(root)
              return { first, outputsWritten, afterIgnored, afterForeignReport }
            }),
          )),
        Then(
          'files under the always-ignored patterns and at every output keep every verdict, and a foreign report refuses them',
        )((s, expect) => {
          const planned = s.runs.afterIgnored.reuse?.reused ?? 0
          return expect({
            exitCodes: [s.runs.first, s.runs.afterIgnored, s.runs.afterForeignReport].map((run) => run.exitCode),
            outputsWritten: s.runs.outputsWritten,
            plannedNonZero: planned > 0,
            afterIgnored: {
              ran: s.runs.afterIgnored.reuse?.ran,
              closureChanged: s.runs.afterIgnored.reuse?.refused.closureChanged,
            },
            afterForeignReport: {
              reused: s.runs.afterForeignReport.reuse?.reused,
              closureChanged: s.runs.afterForeignReport.reuse?.refused.closureChanged,
            },
          }).toEqual({
            exitCodes: [0, 0, 0],
            outputsWritten: WRITTEN_OUTPUTS.map(() => true),
            plannedNonZero: true,
            afterIgnored: { ran: 0, closureChanged: 0 },
            afterForeignReport: { reused: 0, closureChanged: planned },
          })
        }),
      ),
    )

    scenario(
      'The --ignorePatterns help lists exactly what Stryker always ignores',
      Gherkin.Do.pipe(
        Given('the help the built binary renders for stryker run')('help', () => renderedHelp),
        Then('it lists the always-ignored patterns and every output by its option, and promises nothing for reports/')(
          (s, expect) =>
            expect({
              exitCode: s.help.exitCode,
              listed: ALWAYS_IGNORED_LIST.exec(s.help.text)?.[1]?.split(', ').map((item) => item.replaceAll('`', '')),
              outputs: OUTPUT_LIST.exec(s.help.text)?.[1]?.split(', '),
              claimsReportsIgnored: s.help.text.includes('`/reports`'),
            }).toEqual({
              exitCode: 0,
              listed: ALWAYS_IGNORED.map(([pattern]) => pattern),
              outputs: NAMED_OUTPUTS,
              claimsReportsIgnored: false,
            }),
        ),
      ),
    )
  })
