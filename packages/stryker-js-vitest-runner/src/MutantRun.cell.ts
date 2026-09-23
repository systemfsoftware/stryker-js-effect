import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { type MutantRunOptions, TestRunnerFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import type { RunnerTestCase } from 'vitest'

import { interpretVitestMutantRun } from './interpret-vitest-mutant-run.workflow.js'
import { VitestSession } from './VitestSession.service.js'
import type { VitestRunnerOptions } from './VitestRunner.schema.js'
import type { RunFilter } from './VitestRunner.service.js'

/** What one mutant run needs from the runner: raw collection, hit harvesting and the trap decision. */
export interface MutantRunCellDeps {
  readonly collectRaw: (
    filter: RunFilter,
  ) => Effect.Effect<
    { readonly rawTests: readonly RunnerTestCase[]; readonly hasExternalError: boolean; readonly externalErrorText: string },
    TestRunnerFailed
  >
  readonly hitCount: Effect.Effect<number | undefined>
  readonly reportAllKillers: boolean
  readonly projectRoot: string
  readonly vitestOptions: Effect.Effect<VitestRunnerOptions, TestRunnerFailed>
}

const trapIdMatches = (mutantId: string, trapId: string | undefined): boolean => {
  if (trapId === undefined) {
    return false
  }
  return trapId === mutantId
}

const trapFilePresent = (trapFile: string | undefined): trapFile is string => {
  if (trapFile === undefined) {
    return false
  }
  return trapFile.length > 0
}

const fileEndsWithTrap = (fileName: string, needle: string): boolean => {
  if (fileName === needle) {
    return true
  }
  return fileName.endsWith(`/${needle}`)
}

const trapFileMatches = (fileName: string, trapFile: string | undefined): boolean => {
  if (!trapFilePresent(trapFile)) {
    return false
  }
  const normalizedFile = fileName.replaceAll('\\', '/')
  const needle = trapFile.replaceAll('\\', '/')
  return fileEndsWithTrap(normalizedFile, needle)
}

const idFromTrapId = (mutantId: string, trapId: string | undefined): string | undefined => {
  if (!trapIdMatches(mutantId, trapId)) {
    return undefined
  }
  return mutantId
}

const idFromTrapFile = (
  mutant: { readonly id: string; readonly fileName: string },
  trapFile: string | undefined,
): string | undefined => {
  if (!trapFileMatches(mutant.fileName, trapFile)) {
    return undefined
  }
  return mutant.id
}

const namedTrapIdOf = (
  mutant: { readonly id: string; readonly fileName: string },
  options: { readonly timeoutTrapFile?: string | undefined; readonly timeoutTrapMutantId?: string | undefined },
): string | undefined =>
  idFromTrapId(mutant.id, options.timeoutTrapMutantId) ?? idFromTrapFile(mutant, options.timeoutTrapFile)

export const makeMutantRunCell = (deps: MutantRunCellDeps) =>
  Sandwich.named('stryker.vitest.mutant_run')((command: MutantRunOptions) =>
        Effect.gen(function*() {
          const session = yield* VitestSession
          yield* session.setMode('mutant')
          yield* session.provide('hitLimit', command.hitLimit)
          yield* session.provide('mutantActivation', command.mutantActivation)
          yield* session.provide('activeMutant', command.activeMutant.id)
          const { rawTests, hasExternalError, externalErrorText } = yield* deps.collectRaw({
            testIds: Option.getOrUndefined(
              Option.map(Option.fromNullishOr(command.testFilter), (ids) => [...ids]),
            ),
            relatedFiles: [command.sandboxFileName],
          })
          const hitCount = yield* deps.hitCount
          const reportAllKillers = deps.reportAllKillers
          const vitestOptions = yield* deps.vitestOptions
          const namedTrapId = namedTrapIdOf(command.activeMutant, vitestOptions)
          return {
            _tag: 'VitestMutantRunCommand' as const,
            tests: { projectRoot: deps.projectRoot, records: rawTests },
            hasExternalError,
            externalErrorText,
            hitCount,
            hitLimit: command.hitLimit,
            reportAllKillers,
            activeMutantId: command.activeMutant.id,
            namedTrapId,
          }
        })
      )
        .decide(interpretVitestMutantRun)
        .write({
          Killed: (killed) =>
            Effect.succeed({
              status: 'killed' as const,
              failureMessage: killed.failureMessage ?? '',
              killedBy: Option.getOrElse(
                Option.map(Option.fromNullishOr(killed.killerIds), (ids) => [...ids]),
                () => [],
              ),
              nrOfTests: killed.tests.length,
            }),
          Survived: (survived) =>
            Effect.succeed({ status: 'survived' as const, nrOfTests: survived.tests.length }),
          Timeout: (timeout) =>
            Effect.succeed(
              Option.match(Option.fromNullishOr(timeout.reason), {
                onNone: () => ({ status: 'timeout' as const }),
                onSome: (reason) => ({ status: 'timeout' as const, reason }),
              }),
            ),
          Error: (error) =>
            Effect.succeed({ status: 'error' as const, errorMessage: error.errorMessage ?? 'unknown' }),
          CommandRejected: ({ issue }) =>
            Effect.fail(new TestRunnerFailed({ runnerName: 'vitest', phase: 'mutantRun', cause: issue })),
        })
