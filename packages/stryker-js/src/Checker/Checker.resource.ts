import { CheckerRpcs, type StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import type * as Scope from 'effect/Scope'

import { makeWorkerClient } from '../worker-client.resource.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import {
  type CheckerCrash,
  type CheckerResourceService,
  connectionCrashed,
  makeCheckerHandle,
} from './Checker.handle.js'

export interface CheckerSpec {
  readonly options: StrykerOptions
  readonly workerEntrypoint: string
  readonly workingDirectory: string
}

const checkerProcessCrashes = Metric.counter('stryker.checker.process_crashes', {
  description: 'Checker worker processes that never became usable',
  incremental: true,
})

const TEMP_DIR_PREFIX = 'stryker-checker-'

const nodeArgsOf = (options: StrykerOptions) =>
  Match.value(options.checkers[0]?.nodeArgs).pipe(
    Match.when(Match.undefined, () => options.checkerNodeArgs),
    Match.orElse((args) => args),
  )

const acquire = (spec: CheckerSpec) =>
  Effect.gen(function*() {
    const client = yield* makeWorkerClient({
      rpcs: CheckerRpcs,
      options: spec.options,
      entrypoint: spec.workerEntrypoint,
      workingDirectory: spec.workingDirectory,
      execArgv: [...nodeArgsOf(spec.options)],
      tempDirPrefix: TEMP_DIR_PREFIX,
    }).pipe(
      Effect.mapError((error) =>
        Match.value(error).pipe(
          Match.tag('ChildProcessCrashedError', 'OutOfMemoryError', (crash) => crash),
          Match.tag(
            'WorkerBootTimeoutError',
            () =>
              connectionCrashed(
                `Checker worker failed to start: its boot window closed before it accepted the RPC connection`,
              ),
          ),
          Match.exhaustive,
        )
      ),
      Effect.tapError(() => Metric.update(checkerProcessCrashes, 1)),
    )
    return makeCheckerHandle(client)
  })

export const scoped = (
  spec: CheckerSpec,
): Effect.Effect<CheckerResourceService, CheckerCrash, Scope.Scope | WorkerLauncher> => acquire(spec)
