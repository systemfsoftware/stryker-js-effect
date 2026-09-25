import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Worker } from '@systemfsoftware/stryker-js'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type ChildBehaviour,
  PingRpcs,
  substitutedLauncher,
  WORKER_ENTRYPOINT,
  WORKER_PID,
} from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it })

const WORKING_DIRECTORY = '/project/.stryker-tmp/sandbox-1'
const EXEC_ARGV: readonly string[] = ['--enable-source-maps']
const PLUGIN_OPTIONS = { plugins: ['file:///project/node_modules/@acme/stryker-runner/dist/worker.mjs'] }
const TEMP_DIR_PREFIX = 'stryker-plugin-'

interface BootOutcome<E = unknown> {
  readonly answer: Result.Result<string, E>
  readonly spawns: readonly Worker.WorkerSpawnParams[]
  readonly options: Options.StrykerOptions
}

const bootPingWorker = (
  behaviour: ChildBehaviour,
): Effect.Effect<BootOutcome> =>
  Effect.gen(function*() {
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)(PLUGIN_OPTIONS).pipe(Effect.orDie)
    const launcher = yield* substitutedLauncher(behaviour)
    const answer = yield* Worker.makeWorkerClient({
      rpcs: PingRpcs,
      options,
      entrypoint: WORKER_ENTRYPOINT,
      workingDirectory: WORKING_DIRECTORY,
      execArgv: EXEC_ARGV,
      tempDirPrefix: TEMP_DIR_PREFIX,
      env: undefined,
    }).pipe(
      Effect.flatMap((client) => client.ping({ message: 'boot' })),
      Effect.provide(launcher.layer),
      Effect.result,
    )
    return { answer, spawns: yield* Ref.get(launcher.spawns), options }
  }).pipe(Effect.scoped)

const bootFailure = <E = unknown>(boot: BootOutcome<E>): E =>
  Result.match(boot.answer, {
    onFailure: (error) => error,
    onSuccess: (answer) => {
      throw new Error(`the boot was expected to fail, but the worker answered ${answer}`)
    },
  })

const bootAnswer = (boot: BootOutcome): string =>
  Result.match(boot.answer, {
    onFailure: (error) => {
      throw new Error('the boot was expected to succeed, but it failed', { cause: error })
    },
    onSuccess: (answer) => answer,
  })

const timeoutOf = (boot: BootOutcome): Worker.WorkerBootTimeoutError => {
  const failure = bootFailure(boot)
  if (S.is(Worker.WorkerBootTimeoutError)(failure)) {
    return failure
  }
  throw new Error('the boot was expected to fail as a boot timeout', { cause: failure })
}

const crashOf = (boot: BootOutcome): Worker.ChildProcessCrashedError => {
  const failure = bootFailure(boot)
  if (S.is(Worker.ChildProcessCrashedError)(failure)) {
    return failure
  }
  throw new Error('the boot was expected to fail as a crash', { cause: failure })
}

const memoryOf = (boot: BootOutcome): Worker.OutOfMemoryError => {
  const failure = bootFailure(boot)
  if (S.is(Worker.OutOfMemoryError)(failure)) {
    return failure
  }
  throw new Error('the boot was expected to fail as an out-of-memory death', { cause: failure })
}

const readingOf = (decision: Worker.ClassifyWorkerExitDecision): string =>
  Match.value(decision).pipe(
    Match.tag('WorkerOutOfMemory', (outOfMemory) => `memory exhaustion at exit ${outOfMemory.exitCode}`),
    Match.tag('WorkerCrashed', () => 'a crash'),
    Match.exhaustive,
  )

Feature('Running each plugin worker as its own process')
  .withLayer(Layer.empty)
  .live('the host connects to its plugin worker over a socket and exchanges RPC frames, which the kernel cannot settle')
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'A plugin worker comes up on its own entry and answers the host',
      Gherkin.Do.pipe(
        Given('a plugin whose own worker entry is ready to serve')(
          'boot',
          () => bootPingWorker('acceptsConnection'),
        ),
        When('the host starts that plugin')(
          'seen',
          (s) => Effect.sync(() => ({ answer: bootAnswer(s.boot), spawns: s.boot.spawns })),
        ),
        Then('the worker answers over the connection, and the host started it by the entry the plugin resolved')((
          s,
          expect,
        ) =>
          Effect.gen(function*() {
            const spawn = yield* Option.match(Option.fromNullishOr(s.seen.spawns.at(0)), {
              onNone: () => Effect.die('the host never started the substituted worker'),
              onSome: (started) => Effect.succeed(started),
            })
            const handedOptions = yield* S.decodeEffect(S.fromJsonString(Options.StrykerOptionsSchema))(
              spawn.optionsJson,
            )
            return {
              answer: s.seen.answer,
              spawnCount: s.seen.spawns.length,
              handedOptions,
              entrypoint: spawn.entrypoint,
              workingDirectory: spawn.workingDirectory,
              execArgv: spawn.execArgv,
              tempDirPrefix: spawn.tempDirPrefix,
              env: spawn.env,
            }
          }).pipe(Effect.map((facts) =>
            expect(facts).toEqual({
              answer: 'pong:boot',
              spawnCount: 1,
              handedOptions: s.boot.options,
              entrypoint: WORKER_ENTRYPOINT,
              workingDirectory: WORKING_DIRECTORY,
              execArgv: EXEC_ARGV,
              tempDirPrefix: TEMP_DIR_PREFIX,
              env: undefined,
            })
          ))
        ),
      ),
    )

    scenario(
      'A worker that never accepts the connection is reported, not hung on',
      Gherkin.Do.pipe(
        Given('a plugin whose own worker entry never accepts a connection')(
          'boot',
          () => bootPingWorker('neverBinds'),
        ),
        When('the host starts that plugin')(
          'timeout',
          (s) => Effect.sync(() => timeoutOf(s.boot)),
        ),
        Then('the host reports that the worker never came up, naming the child it started')((s, expect) =>
          expect(s.timeout.pid).toEqual(WORKER_PID)
        ),
      ),
    )

    scenarioOutline(
      'A worker that <ending> while it boots is reported as <reported>',
      [
        { ending: 'dies', reported: 'a crash', behaviour: 'crashes', killed: false },
        { ending: 'runs out of memory', reported: 'memory exhaustion', behaviour: 'runsOutOfMemory', killed: true },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a plugin whose own worker entry ${row.ending} while it boots`)(
            'boot',
            () => bootPingWorker(row.behaviour),
          ),
          When('the host starts that plugin')(
            'failure',
            (s) => Effect.sync(() => bootFailure(s.boot)),
          ),
          Then(`the host reports ${row.reported}, keeping the ending the process itself had`)((s, expect) => {
            if (row.killed) {
              const outOfMemory = memoryOf(s.boot)
              return expect({ pid: outOfMemory.pid, exitCode: outOfMemory.exitCode }).toEqual({
                pid: WORKER_PID,
                exitCode: 137,
              })
            }
            const crashed = crashOf(s.boot)
            return expect({ pid: crashed.pid, exit: crashed.exit }).toEqual({
              pid: WORKER_PID,
              exit: { _tag: 'Code', code: 9 },
            })
          }),
        ),
    )

    scenario(
      'An ending in memory exhaustion is reported as memory exhaustion, any other ending as a crash',
      Gherkin.Do.pipe(
        Given('worker processes that ended with these codes')('codes', () => Effect.succeed([137, 134, 143, 0, 1])),
        When('each ending is read')(
          'readings',
          (s) =>
            Effect.sync(() =>
              s.codes.map((code) =>
                Result.match(
                  Worker.classifyWorkerExit(Worker.ClassifyWorkerExitCommand.make({ pid: WORKER_PID, exitCode: code })),
                  {
                    onFailure: (refused) => refused,
                    onSuccess: (classified) => classified,
                  },
                )
              )
            ),
        ),
        Then('the memory signals are reported as memory exhaustion and the others as a crash')((s, expect) =>
          expect(s.readings.map(readingOf)).toEqual([
            'memory exhaustion at exit 137',
            'memory exhaustion at exit 134',
            'a crash',
            'a crash',
            'a crash',
          ])
        ),
      ),
    )
  })
