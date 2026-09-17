import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  ChildProcessCrashedError,
  classifyWorkerExit,
  makeWorkerClient,
  OutOfMemoryError,
  WorkerBootTimeoutError,
} from '@systemfsoftware/stryker-js-engine'
import type { WorkerSpawnParams } from '@systemfsoftware/stryker-js-engine'
import { Module } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import { expect } from 'vitest'

import {
  type ChildBehaviour,
  PingRpcs,
  substitutedLauncher,
  WORKER_ENTRYPOINT,
  WORKER_PID,
} from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it, layer })

const WORKING_DIRECTORY = '/project/.stryker-tmp/sandbox-1'
const EXEC_ARGV: readonly string[] = ['--enable-source-maps']
const OPTIONS_JSON = '{"plugins":["@acme/stryker-runner"]}'
const TEMP_DIR_PREFIX = 'stryker-plugin-'

const spawnParams = (): WorkerSpawnParams => ({
  entrypoint: WORKER_ENTRYPOINT,
  workingDirectory: WORKING_DIRECTORY,
  execArgv: EXEC_ARGV,
  optionsJson: OPTIONS_JSON,
  tempDirPrefix: TEMP_DIR_PREFIX,
})

interface BootOutcome {
  readonly answer: Result.Result<string, unknown>
  readonly spawns: readonly WorkerSpawnParams[]
}

const bootPingWorker = (
  behaviour: ChildBehaviour,
  module: Layer.Layer<Module>,
): Effect.Effect<BootOutcome> =>
  Effect.gen(function*() {
    const launcher = yield* substitutedLauncher(behaviour)
    const answer = yield* makeWorkerClient({ rpcs: PingRpcs, ...spawnParams() }).pipe(
      Effect.flatMap((client) => client.ping({ message: 'boot' })),
      Effect.provide(launcher.layer),
      Effect.provide(module),
      Effect.result,
    )
    return { answer, spawns: yield* Ref.get(launcher.spawns) }
  }).pipe(Effect.scoped)

const unreachableModule: Layer.Layer<Module> = Layer.succeed(Module, {
  findPackageJSON: () => {
    throw new Error('the host must never resolve a plugin module')
  },
})

interface ImportWatch {
  readonly specifiers: string[]
}

const watchedModule = (watch: ImportWatch): Layer.Layer<Module> =>
  Layer.succeed(Module, {
    findPackageJSON: (specifier: string): string | undefined => {
      watch.specifiers.push(specifier)
      throw new Error('the host must never resolve a plugin module')
    },
  })

const bootFailure = (boot: BootOutcome): unknown =>
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

const timeoutOf = (boot: BootOutcome): WorkerBootTimeoutError => {
  const failure = bootFailure(boot)
  if (failure instanceof WorkerBootTimeoutError) {
    return failure
  }
  throw new Error('the boot was expected to fail as a boot timeout', { cause: failure })
}

const crashOf = (boot: BootOutcome): ChildProcessCrashedError => {
  const failure = bootFailure(boot)
  if (failure instanceof ChildProcessCrashedError) {
    return failure
  }
  throw new Error('the boot was expected to fail as a crash', { cause: failure })
}

const memoryOf = (boot: BootOutcome): OutOfMemoryError => {
  const failure = bootFailure(boot)
  if (failure instanceof OutOfMemoryError) {
    return failure
  }
  throw new Error('the boot was expected to fail as an out-of-memory death', { cause: failure })
}

const readingOf = (error: ChildProcessCrashedError | OutOfMemoryError): string =>
  Match.value(error).pipe(
    Match.tag('OutOfMemoryError', (outOfMemory) => `memory exhaustion at exit ${outOfMemory.exitCode}`),
    Match.orElse(() => 'a crash'),
  )

Feature('Running each plugin worker as its own process')
  .liveClock()
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'A plugin worker comes up on its own entry and answers the host',
      Gherkin.Do.pipe(
        Given('a plugin whose own worker entry is ready to serve')(
          'boot',
          () => bootPingWorker('acceptsConnection', unreachableModule),
        ),
        When('the host starts that plugin')(
          'seen',
          (s) => Effect.sync(() => ({ answer: bootAnswer(s.boot), spawns: s.boot.spawns })),
        ),
        Then('the worker answers over the connection, and the host started it by the entry the plugin resolved')((s) =>
          Effect.sync(() => {
            expect(s.seen.answer).toBe('pong:boot')
            expect(s.seen.spawns).toStrictEqual([spawnParams()])
          })
        ),
      ),
    )

    scenario(
      'A worker that never accepts the connection is reported, not hung on',
      Gherkin.Do.pipe(
        Given('a plugin whose own worker entry never accepts a connection')(
          'boot',
          () => bootPingWorker('neverBinds', unreachableModule),
        ),
        When('the host starts that plugin')(
          'timeout',
          (s) => Effect.sync(() => timeoutOf(s.boot)),
        ),
        Then('the host reports that the worker never came up, naming the child it started')((s) =>
          Effect.sync(() => {
            expect(s.timeout.pid).toBe(WORKER_PID)
          })
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
            () => bootPingWorker(row.behaviour, unreachableModule),
          ),
          When('the host starts that plugin')(
            'failure',
            (s) => Effect.sync(() => bootFailure(s.boot)),
          ),
          Then(`the host reports ${row.reported}, keeping the ending the process itself had`)((s) =>
            Effect.sync(() => {
              if (row.killed) {
                const outOfMemory = memoryOf(s.boot)
                expect(outOfMemory.pid).toBe(WORKER_PID)
                expect(outOfMemory.exitCode).toBe(137)
                return
              }
              const crashed = crashOf(s.boot)
              expect(crashed.pid).toBe(WORKER_PID)
              expect(crashed.exit).toStrictEqual({ _tag: 'Code', code: 9 })
            })
          ),
        ),
    )

    scenario(
      'An ending in memory exhaustion is reported as memory exhaustion, any other ending as a crash',
      Gherkin.Do.pipe(
        Given('worker processes that ended with these codes')('codes', () => Effect.succeed([137, 134, 143, 0, 1])),
        When('each ending is read')(
          'readings',
          (s) => Effect.sync(() => s.codes.map((code) => classifyWorkerExit(WORKER_PID, code))),
        ),
        Then('the memory signals are reported as memory exhaustion and the others as a crash')((s) =>
          Effect.sync(() => {
            expect(s.readings.map(readingOf)).toStrictEqual([
              'memory exhaustion at exit 137',
              'memory exhaustion at exit 134',
              'a crash',
              'a crash',
              'a crash',
            ])
          })
        ),
      ),
    )

    scenario(
      'A plugin worker is started by path alone, without the host importing the plugin',
      Gherkin.Do.pipe(
        Given('a plugin whose own worker entry is ready to serve, and a project whose plugins cannot be imported')(
          'watch',
          () => Effect.sync((): ImportWatch => ({ specifiers: [] })),
        ),
        When('the host starts that plugin with that project')(
          'boot',
          (s) => bootPingWorker('acceptsConnection', watchedModule(s.watch)),
        ),
        Then('the worker answers, and no plugin module was ever imported')((s) =>
          Effect.sync(() => {
            expect(bootAnswer(s.boot)).toBe('pong:boot')
            expect(s.watch.specifiers).toStrictEqual([])
          })
        ),
      ),
    )
  })
