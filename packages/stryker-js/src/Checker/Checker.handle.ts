import { Handle } from '@systemfsoftware/effect-cell-types'
import { Checker, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import type * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'

import { ChildProcessCrashedError, OutOfMemoryError } from '../Worker.schema.js'

export type CheckerCrash = ChildProcessCrashedError | OutOfMemoryError

export const TypeId: unique symbol = Symbol.for('~systemfsoftware/stryker-js/Checker')
export type TypeId = typeof TypeId

const checkerDuration = Metric.timer('stryker.checker.duration', {
  description: 'Checker worker RPC duration in milliseconds',
})

const checkerMutantsChecked = Metric.counter('stryker.checker.mutants.checked', {
  description: 'Total number of mutants a checker worker answered for',
})

const checkerRpcFailures = Metric.counter('stryker.checker.rpc_failures', {
  description: 'Checker worker RPC calls that did not complete, excluding interruptions',
  incremental: true,
})

type CheckerRpcsUnion = typeof Plugin.CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never
type CheckerClient = RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>

const CheckerHandle = Handle.make<Record<never, never>, CheckerClient>()(TypeId)

export type CheckerHandle = Handle.Of<typeof CheckerHandle>

export const isCheckerHandle = CheckerHandle.is

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
    mutants: readonly Checker.CheckerMutantWire[],
  ) => Effect.Effect<Record<string, Checker.CheckResult>, CheckerCrash | Checker.CheckerFailed>
  readonly group: (
    checkerName: string,
    mutants: readonly Checker.CheckerMutantWire[],
  ) => Effect.Effect<readonly (readonly string[])[], CheckerCrash | Checker.CheckerFailed>
}

export const connectionCrashed = (cause: string): ChildProcessCrashedError =>
  ChildProcessCrashedError.make({ pid: 0, exit: { _tag: 'Code', code: 1 }, cause })

const recordCheckerCall = <A>(
  spanName: string,
  checkerName: string,
  mutants: readonly Checker.CheckerMutantWire[],
  call: Effect.Effect<A, Checker.CheckerFailed | { readonly message: string }>,
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

const checkOf = (self: CheckerHandle, checkerName: string, mutants: readonly Checker.CheckerMutantWire[]) =>
  recordCheckerCall(
    'stryker.checker.check',
    checkerName,
    mutants,
    CheckerHandle.slot(self).check({ checkerName, mutants: [...mutants] }),
  )

const groupOf = (self: CheckerHandle, checkerName: string, mutants: readonly Checker.CheckerMutantWire[]) =>
  recordCheckerCall(
    'stryker.checker.group',
    checkerName,
    mutants,
    CheckerHandle.slot(self).group({ checkerName, mutants: [...mutants] }),
  )

export const check: {
  (
    checkerName: string,
    mutants: readonly Checker.CheckerMutantWire[],
  ): (self: CheckerHandle) => Effect.Effect<Record<string, Checker.CheckResult>, CheckerCrash | Checker.CheckerFailed>
  (
    self: CheckerHandle,
    checkerName: string,
    mutants: readonly Checker.CheckerMutantWire[],
  ): Effect.Effect<Record<string, Checker.CheckResult>, CheckerCrash | Checker.CheckerFailed>
} = dual(
  (args) => isCheckerHandle(args[0]),
  (self: CheckerHandle, checkerName: string, mutants: readonly Checker.CheckerMutantWire[]) =>
    checkOf(self, checkerName, mutants),
)

export const group: {
  (
    checkerName: string,
    mutants: readonly Checker.CheckerMutantWire[],
  ): (self: CheckerHandle) => Effect.Effect<readonly (readonly string[])[], CheckerCrash | Checker.CheckerFailed>
  (
    self: CheckerHandle,
    checkerName: string,
    mutants: readonly Checker.CheckerMutantWire[],
  ): Effect.Effect<readonly (readonly string[])[], CheckerCrash | Checker.CheckerFailed>
} = dual(
  (args) => isCheckerHandle(args[0]),
  (self: CheckerHandle, checkerName: string, mutants: readonly Checker.CheckerMutantWire[]) =>
    groupOf(self, checkerName, mutants),
)

export const makeCheckerHandle = (client: CheckerClient): CheckerHandle => CheckerHandle.make({}, client)
