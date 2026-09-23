import {
  CheckerFailed,
  CheckerMutantWire,
  CheckerRpcs,
  type CheckResult,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import * as Predicate from 'effect/Predicate'
import type * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'

import { checkerDuration, checkerMutantsChecked, checkerRpcFailures } from '../metrics.js'
import { ChildProcessCrashedError, OutOfMemoryError } from '../Worker.schema.js'

export type CheckerCrash = ChildProcessCrashedError | OutOfMemoryError

export const TypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CheckerHandle')
export type TypeId = typeof TypeId

const ClientTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CheckerHandle/client')

type CheckerRpcsUnion = typeof CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never
type CheckerClient = RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>

/**
 * A checker held by the pool.
 *
 * The pool must be able to interrupt a checker mid-call when the run is
 * cancelled, so the port uses Effect, which can be interrupted, where a Promise
 * cannot. The error channel names both crash variants rather than `unknown`,
 * which lets the retry combinator prove it handles every one of them.
 */
export interface CheckerResourceService {
  readonly check: (
    checkerName: string,
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<Record<string, CheckResult>, CheckerCrash | CheckerFailed>
  readonly group: (
    checkerName: string,
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<readonly (readonly string[])[], CheckerCrash | CheckerFailed>
}

export interface CheckerHandle extends CheckerResourceService, Pipeable {
  readonly [TypeId]: TypeId
  readonly [ClientTypeId]: CheckerClient
}

export const isCheckerHandle = (u: unknown): u is CheckerHandle => Predicate.hasProperty(u, TypeId)

export const connectionCrashed = (cause: string): ChildProcessCrashedError =>
  ChildProcessCrashedError.make({ pid: 0, exit: { _tag: 'Code', code: 1 }, cause })

const recordCheckerCall = <A>(
  spanName: string,
  checkerName: string,
  mutants: readonly CheckerMutantWire[],
  call: Effect.Effect<A, CheckerFailed | { readonly message: string }>,
) =>
  call.pipe(
    Effect.withSpan(spanName, {
      attributes: {
        'stryker.checker.name': checkerName,
        'stryker.mutants.count': mutants.length,
      },
    }),
    Effect.timed,
    Effect.onExit((exit) =>
      Match.value(exit).pipe(
        Match.tag('Success', () => Metric.update(checkerMutantsChecked, mutants.length)),
        Match.tag('Failure', (failure) =>
          failure.cause.pipe(
            Cause.hasInterruptsOnly,
            Match.value,
            Match.when(true, () => Effect.void),
            Match.orElse(() => Metric.update(checkerRpcFailures, 1)),
          )),
        Match.exhaustive,
      )
    ),
    Effect.tap(([duration]) => Metric.update(checkerDuration, duration)),
    Effect.map(([, result]) => result),
    Effect.mapError((error) =>
      Match.value(error).pipe(
        Match.tag('CheckerFailed', (failed) => failed),
        Match.orElse((e) => connectionCrashed(e.message)),
      )
    ),
  )

const checkOf = (self: CheckerHandle, checkerName: string, mutants: readonly CheckerMutantWire[]) =>
  recordCheckerCall(
    'stryker.checker.check',
    checkerName,
    mutants,
    self[ClientTypeId].check({ checkerName, mutants: [...mutants] }),
  )

const groupOf = (self: CheckerHandle, checkerName: string, mutants: readonly CheckerMutantWire[]) =>
  recordCheckerCall(
    'stryker.checker.group',
    checkerName,
    mutants,
    self[ClientTypeId].group({ checkerName, mutants: [...mutants] }),
  )

export const makeCheckerHandle = (client: CheckerClient): CheckerHandle => {
  const self: CheckerHandle = {
    [TypeId]: TypeId,
    [ClientTypeId]: client,
    ...Prototype,
    check: (checkerName, mutants) => checkOf(self, checkerName, mutants),
    group: (checkerName, mutants) => groupOf(self, checkerName, mutants),
  }
  return self
}
