import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter/mutants'
import { Checker, CheckerFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import { readWorkerOptionsFromEnv } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'

import { makeCheckerService } from './Checker.js'
import { makeHybridFileSystem, makeTypescriptCompiler } from './Compiler.js'

const mutantIdsOf = (mutants: readonly Mutant[]): ReadonlyArray<string> => mutants.map((mutant) => mutant.id)

const buildChecker = (
  options: StrykerOptions,
): Effect.Effect<Checker['Service'], unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fsService = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const fs = yield* makeHybridFileSystem(fsService)
    const compiler = makeTypescriptCompiler(options, fs, fsService, pathService)
    const checker = makeCheckerService({ options, compiler })
    yield* checker.init
    return checker
  })

export const checkerHandlers = CheckerRpcs.toLayer(
  Effect.gen(function*() {
    const options = yield* readWorkerOptionsFromEnv
    const checkers = yield* Effect.cached(
      Effect.forEach(
        options.checkers,
        (name: string) =>
          Effect.result(
            buildChecker(options).pipe(Effect.catchCause((cause) => Effect.fail(cause))),
          ).pipe(Effect.map((outcome) => [name, outcome] as const)),
        { concurrency: 'unbounded', discard: false },
      ).pipe(Effect.map(HashMap.fromIterable)),
    )

    const resolve = (
      checkerName: string,
      mutants: readonly Mutant[],
    ): Effect.Effect<Checker['Service'], CheckerFailed, FileSystem.FileSystem | Path.Path> =>
      checkers.pipe(
        Effect.flatMap((built) =>
          Option.match(HashMap.get(built, checkerName), {
            onNone: () =>
              Effect.fail(
                CheckerFailed.make({
                  cause: `Checker ${checkerName} does not exist`,
                  checkerName,
                  mutantIds: mutantIdsOf(mutants),
                }),
              ),
            onSome: (outcome) =>
              Result.match(outcome, {
                onFailure: (cause) =>
                  Effect.fail(
                    CheckerFailed.make({
                      cause: Cause.pretty(cause),
                      checkerName,
                      mutantIds: mutantIdsOf(mutants),
                    }),
                  ),
                onSuccess: (checker) => Effect.succeed(checker),
              }),
          })
        ),
      )

    return {
      check: ({ checkerName, mutants }: { readonly checkerName: string; readonly mutants: readonly Mutant[] }) =>
        resolve(checkerName, mutants).pipe(
          Effect.flatMap((checker) => checker.check([...mutants])),
          Effect.map((resultMap) => Object.fromEntries(resultMap)),
        ),

      group: ({ checkerName, mutants }: { readonly checkerName: string; readonly mutants: readonly Mutant[] }) =>
        resolve(checkerName, mutants).pipe(
          Effect.flatMap((checker) => checker.group([...mutants])),
        ),
    }
  }),
)
