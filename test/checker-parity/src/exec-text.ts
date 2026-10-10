import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as ChildProcess from 'effect/process/ChildProcess'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Stream from 'effect/Stream'

import { ShellFailure } from './Shell.schema.js'

export interface ExecRequest {
  readonly file: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
}

const failed = (request: ExecRequest, detail: string): ShellFailure =>
  ShellFailure.make({
    schemaVersion: 1,
    code: 'io-failed',
    reason: `${request.file} ${request.args.join(' ')} ${detail}`,
    nextAction: `Run \`${request.file} ${request.args.join(' ')}\` in ${request.cwd} and fix what it reports.`,
  })

export const execText = (
  request: ExecRequest,
): Effect.Effect<string, ShellFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(request.file, [...request.args], {
        cwd: request.cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, exitCode] = yield* Effect.all([
        handle.stdout.pipe(Stream.decodeText, Stream.mkString),
        handle.stderr.pipe(Stream.decodeText, Stream.mkString),
        handle.exitCode,
      ], { concurrency: 'unbounded' })
      return yield* Boolean.match(Number(exitCode) === 0, {
        onTrue: () => Effect.succeed(stdout),
        onFalse: () => Effect.fail(failed(request, `exited ${Number(exitCode)}: ${stderr.trim()}`)),
      })
    }),
  ).pipe(
    Effect.catchTag('PlatformError', (cause) => Effect.fail(failed(request, `could not start: ${cause.message}`))),
  )
