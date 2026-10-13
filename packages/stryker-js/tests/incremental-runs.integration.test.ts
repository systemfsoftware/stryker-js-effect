import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import {
  exitOf,
  jsProjectFiles,
  logFile,
  type ProjectFiles,
  REPORT_FILE,
  runCliKilledAtFirstMutant,
  runCounted,
  statusesOf,
  writeFiles,
  writeProject,
} from './__fixtures__/cli-project.fixture.js'

const Feature = makeFeature({ it })

const freshRun = (args: ReadonlyArray<string>) =>
  Effect.flatMap(
    logFile,
    (log) => Effect.flatMap(writeProject(jsProjectFiles({ log })), (root) => runCounted({ root, log, args })),
  )

const KILLING_TEST = 'adds two numbers'

const killerAndBystanderTests = (log: string): ProjectFiles => [
  [
    'test/killing.test.mjs',
    [
      "import { appendFileSync } from 'node:fs'",
      "import { expect, test } from 'vitest'",
      "import math from '../src/math.js'",
      '',
      `test('${KILLING_TEST}', () => {`,
      `  appendFileSync(${JSON.stringify(log)}, '${KILLING_TEST}\\n')`,
      '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)',
      '  expect(math.add(1, 2)).toBe(3)',
      '})',
      '',
    ].join('\n'),
  ],
  [
    'test/bystander.test.mjs',
    [
      "import { appendFileSync } from 'node:fs'",
      "import { test } from 'vitest'",
      "import math from '../src/math.js'",
      '',
      "test('calls add without checking its result', () => {",
      `  appendFileSync(${JSON.stringify(log)}, 'calls add\\n')`,
      '  math.add(1, 2)',
      '})',
      '',
    ].join('\n'),
  ],
]

interface KilledByOneOfSeveral {
  readonly testsCompleted: number | undefined
  readonly killers: readonly string[]
}

const decodeReport = S.decodeUnknownOption(S.fromJsonString(Report.MutationTestResult))

const killedByOneOfSeveralOf = (
  root: string,
): Effect.Effect<readonly KilledByOneOfSeveral[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, REPORT_FILE)).pipe(Effect.orElseSucceed(() => ''))
    return Option.match(decodeReport(text), {
      onNone: (): readonly KilledByOneOfSeveral[] => [],
      onSome: (report) => {
        const nameById: Record<string, string> = Object.fromEntries(
          Object.values(report.testFiles ?? {}).flatMap((file) => file.tests.map((test) => [test.id, test.name])),
        )
        return Object.values(report.files)
          .flatMap((file) => file.mutants)
          .filter((mutant) => mutant.status === 'Killed' && (mutant.coveredBy ?? []).length > 1)
          .map((mutant) => ({
            testsCompleted: mutant.testsCompleted,
            killers: (mutant.killedBy ?? []).map((id) => nameById[id] ?? id),
          }))
      },
    })
  })

Feature('Re-running mutation testing on a project')
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs real projects in temporary directories')
  .body(({ scenario }) => {
    scenario(
      'A run killed after it scored its first mutant spares the next run its initial test run',
      Gherkin.Do.pipe(
        Given('a full run and a dry-run-only run as references, and a run killed at its first scored mutant')(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const reference = yield* freshRun(['run'])
              const dryRun = yield* freshRun(['run', '--dryRunOnly'])
              const log = yield* logFile
              const hold = { release: `${log}.release`, afterExecutions: dryRun.executions }
              const release = writeFiles(path.dirname(hold.release), [[path.basename(hold.release), '']])
              yield* Effect.addFinalizer(() => release)
              const root = yield* writeProject(jsProjectFiles({ log, hold }))
              const killedAtMutant = yield* runCliKilledAtFirstMutant({ root, args: ['run'] })
              const finishedBeforeKill = yield* fs.exists(path.join(root, REPORT_FILE))
              yield* release
              const next = yield* runCounted({ root, log, args: ['run'] })
              return { reference, dryRun, killedAtMutant, finishedBeforeKill, next }
            })),
        ),
        Then('the killed run stopped mid-run, and the next run skips the dry run and scores as the reference')(
          (s, expect) =>
            expect({
              killedMidRun: s.observed.killedAtMutant && !s.observed.finishedBeforeKill,
              exits: [exitOf(s.observed.reference), exitOf(s.observed.dryRun), exitOf(s.observed.next)],
              dryRunExecuted: s.observed.dryRun.executions > 0,
              referenceStatuses: statusesOf(s.observed.reference.scored),
              nextExecutions: s.observed.next.executions,
              nextScored: s.observed.next.scored,
            }).toEqual({
              killedMidRun: true,
              exits: [0, 0, 0],
              dryRunExecuted: true,
              referenceStatuses: ['Killed', 'NoCoverage'],
              nextExecutions: s.observed.reference.executions - s.observed.dryRun.executions,
              nextScored: s.observed.reference.scored,
            }),
        ),
      ),
    )

    scenario(
      'A dry-run-only run spares the next run its initial test run',
      Gherkin.Do.pipe(
        Given('a full run as the reference, and a dry-run-only run followed by a run on another copy')(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const reference = yield* freshRun(['run'])
              const log = yield* logFile
              const root = yield* writeProject(jsProjectFiles({ log }))
              const dryRunOnly = yield* runCounted({ root, log, args: ['run', '--dryRunOnly'] })
              const next = yield* runCounted({ root, log, args: ['run'] })
              return { reference, dryRunOnly, next }
            })),
        ),
        Then('the run after the dry-run-only run executes only the mutants and scores as the reference')(
          (s, expect) =>
            expect({
              exits: [exitOf(s.observed.reference), exitOf(s.observed.dryRunOnly), exitOf(s.observed.next)],
              dryRunExecuted: s.observed.dryRunOnly.executions > 0,
              referenceStatuses: statusesOf(s.observed.reference.scored),
              nextExecutions: s.observed.next.executions,
              nextScored: s.observed.next.scored,
            }).toEqual({
              exits: [0, 0, 0],
              dryRunExecuted: true,
              referenceStatuses: ['Killed', 'NoCoverage'],
              nextExecutions: s.observed.reference.executions - s.observed.dryRunOnly.executions,
              nextScored: s.observed.reference.scored,
            }),
        ),
      ),
    )

    scenario(
      'A run that refuses every verdict starts each mutant with the test that killed it last time',
      Gherkin.Do.pipe(
        Given(
          'a mutant covered by a fast test and killed by a slower one, run, then run again after a package.json edit',
        )(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const log = yield* logFile
              const root = yield* writeProject(jsProjectFiles({ log }))
              yield* writeFiles(root, killerAndBystanderTests(log))
              const first = yield* runCounted({ root, log, args: ['run'] })
              const firstKilled = yield* killedByOneOfSeveralOf(root)
              yield* writeFiles(root, [['package.json', '{ "type": "commonjs", "description": "edited" }\n']])
              const refused = yield* runCounted({ root, log, args: ['run'] })
              const refusedKilled = yield* killedByOneOfSeveralOf(root)
              return { first, firstKilled, refused, refusedKilled }
            })),
        ),
        Then('the first run tries the fast test first, and the refused run stops at the previous killer')(
          (s, expect) =>
            expect({
              exits: [exitOf(s.observed.first), exitOf(s.observed.refused)],
              refusedRunExecuted: s.observed.refused.executions > 0,
              refusedScored: s.observed.refused.scored,
              firstTestsCompleted: s.observed.firstKilled.map((mutant) => mutant.testsCompleted),
              refusedKilled: s.observed.refusedKilled,
            }).toEqual({
              exits: [0, 0],
              refusedRunExecuted: true,
              refusedScored: s.observed.first.scored,
              firstTestsCompleted: [2, 2],
              refusedKilled: [
                { testsCompleted: 1, killers: [KILLING_TEST] },
                { testsCompleted: 1, killers: [KILLING_TEST] },
              ],
            }),
        ),
      ),
    )
  })
