import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import {
  exitOf,
  INCREMENTAL_FILE,
  jsProjectFiles,
  logFile,
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

const INTERRUPTED_WRITE_TEMP = `${INCREMENTAL_FILE.replace(/[^/]+$/, (name) => `.${name}`)}.5f3a9c1e7b2d4086.tmp`

Feature('Re-running mutation testing on a project after an unfinished run')
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
      'A temp file left by an incremental report write cut short changes nothing the next run reuses',
      Gherkin.Do.pipe(
        Given('a finished run, then the temp file a write of its incremental report leaves when the run is killed')(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const log = yield* logFile
              const root = yield* writeProject(jsProjectFiles({ log }))
              const first = yield* runCounted({ root, log, args: ['run'] })
              yield* writeFiles(root, [[INTERRUPTED_WRITE_TEMP, '{"incrementalVersion":']])
              const next = yield* runCounted({ root, log, args: ['run'] })
              return { first, next }
            })),
        ),
        Then('the next run executes no test and scores as the first')((s, expect) =>
          expect({
            exits: [exitOf(s.observed.first), exitOf(s.observed.next)],
            firstStatuses: statusesOf(s.observed.first.scored),
            nextExecutions: s.observed.next.executions,
            nextScored: s.observed.next.scored,
          }).toEqual({
            exits: [0, 0],
            firstStatuses: ['Killed', 'NoCoverage'],
            nextExecutions: 0,
            nextScored: s.observed.first.scored,
          })
        ),
      ),
    )
  })
