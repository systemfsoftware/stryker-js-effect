import { Console, Duration, Effect, Ref, Stream } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { BenchSetupFailed } from './prepare-side.schema.js'

export type Argv = readonly [string, ...ReadonlyArray<string>]

export interface ShellCommand {
  readonly argv: Argv
  readonly cwd?: string
}

export interface CheckedCommand extends ShellCommand {
  readonly step: string
}

export interface CommandOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const STDERR_TAIL_CHARS = 4000

const failed = (step: string, detail: string, cause?: PlatformError): BenchSetupFailed =>
  cause === undefined ? BenchSetupFailed.make({ step, detail }) : BenchSetupFailed.make({ step, detail, cause })

const tailOf = (outcome: CommandOutcome): string => `${outcome.stdout}${outcome.stderr}`.slice(-STDERR_TAIL_CHARS)

export const runCommand = (
  command: ShellCommand,
): Effect.Effect<CommandOutcome, BenchSetupFailed, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const [name, ...args] = command.argv
    const options = { forceKillAfter: Duration.seconds(10), ...(command.cwd === undefined ? {} : { cwd: command.cwd }) }
    const handle = yield* spawner.spawn(ChildProcess.make(name, args, options)).pipe(
      Effect.mapError((cause) => failed(`spawn ${name}`, 'the command could not be started', cause)),
    )
    const stdout = yield* Ref.make('')
    const stderr = yield* Ref.make('')
    const collect = (stream: typeof handle.stdout, into: Ref.Ref<string>) =>
      Stream.runForEach(Stream.decodeText(stream), (chunk) => Ref.update(into, (text) => text + chunk))
    const [exitCode] = yield* Effect.all(
      [handle.exitCode, collect(handle.stdout, stdout), collect(handle.stderr, stderr)] as const,
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.mapError((cause) => failed(`read ${name} output`, 'the command output could not be read', cause)),
      Effect.onInterrupt(() =>
        Effect.flatMap(
          Effect.all([Ref.get(stdout), Ref.get(stderr)]),
          ([out, err]) =>
            Console.error(
              `bench setup interrupted: ${command.argv.join(' ')}\n--- output tail ---\n${
                `${out}${err}`.slice(-STDERR_TAIL_CHARS)
              }`,
            ),
        )
      ),
    )
    return { exitCode, stdout: yield* Ref.get(stdout), stderr: yield* Ref.get(stderr) }
  }))

export const runChecked = (
  command: CheckedCommand,
): Effect.Effect<CommandOutcome, BenchSetupFailed, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.filterOrFail(
    runCommand(command),
    (outcome) => outcome.exitCode === 0,
    (outcome) => failed(command.step, `exited ${outcome.exitCode}\n${tailOf(outcome)}`),
  )
