import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import type { CheckerRuntimeShape } from './CheckerRuntime.service.js'
import { CheckerRuntime } from './CheckerRuntime.service.js'
import type { CompilerError } from './Compiler.schema.js'
import { configDigest } from './ts-compiler.handle.js'
import { TypeScriptCompiler } from './ts-compiler.service.js'

const refuse = (
  checkerName: string,
  mutants: readonly Checker.CheckerMutantWire[],
  cause: string,
): Checker.CheckerFailed =>
  Checker.CheckerFailed.make({ checkerName, mutantIds: mutants.map((mutant) => mutant.id), cause })

const resolve = (
  runtime: CheckerRuntimeShape,
  checkerName: string,
  mutants: readonly Checker.CheckerMutantWire[],
): Effect.Effect<Checker.Checker['Service'], Checker.CheckerFailed> =>
  Match.value(checkerName).pipe(
    Match.when('typescript', () =>
      runtime.checker.pipe(
        Effect.result,
        Effect.flatMap(
          Result.match({
            onFailure: (cause) => Effect.fail(refuse(checkerName, mutants, Cause.pretty(cause))),
            onSuccess: Effect.succeed,
          }),
        ),
      )),
    Match.orElse(() => Effect.fail(refuse(checkerName, mutants, 'Checker ' + checkerName + ' does not exist'))),
  )

const compilerRefusal = (checkerName: string, cause: CompilerError): Checker.CheckerFailed =>
  refuse(
    checkerName,
    [],
    ErrorText.errorTextOf(cause).pipe(Option.map((rendered) => rendered.text), Option.getOrElse(() => '')),
  )

const configDigestOf = (
  checkerName: string,
): Effect.Effect<Checker.ProgramDigest, Checker.CheckerFailed, TypeScriptCompiler> =>
  Match.value(checkerName).pipe(
    Match.when('typescript', () =>
      TypeScriptCompiler.pipe(
        Effect.flatMap((compiler) => configDigest(compiler)),
        Effect.mapError((cause) => compilerRefusal(checkerName, cause)),
      )),
    Match.orElse(() => Effect.fail(refuse(checkerName, [], 'Checker ' + checkerName + ' does not exist'))),
  )

export const checkerHandlers = Plugin.CheckerRpcs.toLayer(
  Effect.gen(function*() {
    const runtime = yield* CheckerRuntime
    return {
      check: ({
        checkerName,
        mutants,
      }: {
        readonly checkerName: string
        readonly mutants: readonly Checker.CheckerMutantWire[]
      }) =>
        resolve(runtime, checkerName, mutants).pipe(
          Effect.flatMap((checker) => checker.check([...mutants])),
          Effect.map((results) => Object.fromEntries(results)),
        ),

      group: ({
        checkerName,
        mutants,
      }: {
        readonly checkerName: string
        readonly mutants: readonly Checker.CheckerMutantWire[]
      }) => resolve(runtime, checkerName, mutants).pipe(Effect.flatMap((checker) => checker.group([...mutants]))),

      digest: ({ checkerName, scope }: { readonly checkerName: string; readonly scope: 'config' | 'program' }) =>
        Match.value(scope).pipe(
          Match.when('config', () => configDigestOf(checkerName)),
          Match.when(
            'program',
            () => resolve(runtime, checkerName, []).pipe(Effect.flatMap((checker) => checker.digest('program'))),
          ),
          Match.exhaustive,
        ),
    }
  }),
)
