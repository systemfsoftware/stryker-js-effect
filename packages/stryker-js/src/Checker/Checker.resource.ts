import { CheckerRpcs, type StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import type * as Scope from 'effect/Scope'

import { checkerProcessCrashes } from '../metrics.js'
import { makeWorkerClient } from '../worker-client.resource.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import {
  connectionCrashed,
  makeCheckerHandle,
  type CheckerCrash,
  type CheckerHandle,
  type CheckerResourceService,
} from './Checker.handle.js'

export const TypeId = '@systemfsoftware/stryker-js/CheckerResource'
export type TypeId = typeof TypeId

export interface CheckerSpec {
  readonly options: StrykerOptions
  readonly workerEntrypoint: string
  readonly workingDirectory: string
}

export interface CheckerResource extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly spec: CheckerSpec
  withOptions(options: StrykerOptions): CheckerResource
  withWorkerEntrypoint(entrypoint: string): CheckerResource
  withWorkingDirectory(directory: string): CheckerResource
  readonly scoped: Effect.Effect<CheckerHandle, CheckerCrash, Scope.Scope | WorkerLauncher>
}

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

const makeProto = (spec: CheckerSpec): CheckerResource => {
  const self: CheckerResource = {
    [TypeId]: TypeId,
    spec,
    ...Prototype,
    withOptions(options: StrykerOptions): CheckerResource {
      return makeProto({ ...spec, options })
    },
    withWorkerEntrypoint(entrypoint: string): CheckerResource {
      return makeProto({ ...spec, workerEntrypoint: entrypoint })
    },
    withWorkingDirectory(directory: string): CheckerResource {
      return makeProto({ ...spec, workingDirectory: directory })
    },
    get scoped() {
      return acquire(spec)
    },
  }
  return self
}

export const checkerResource = (spec: CheckerSpec): CheckerResource => makeProto(spec)

export const withOptions: {
  (options: StrykerOptions): (spec: CheckerSpec) => CheckerSpec
  (spec: CheckerSpec, options: StrykerOptions): CheckerSpec
} = dual(2, (spec: CheckerSpec, options: StrykerOptions): CheckerSpec => ({ ...spec, options }))

export const withWorkerEntrypoint: {
  (entrypoint: string): (spec: CheckerSpec) => CheckerSpec
  (spec: CheckerSpec, entrypoint: string): CheckerSpec
} = dual(2, (spec: CheckerSpec, entrypoint: string): CheckerSpec => ({ ...spec, workerEntrypoint: entrypoint }))

export const withWorkingDirectory: {
  (directory: string): (spec: CheckerSpec) => CheckerSpec
  (spec: CheckerSpec, directory: string): CheckerSpec
} = dual(2, (spec: CheckerSpec, directory: string): CheckerSpec => ({ ...spec, workingDirectory: directory }))

