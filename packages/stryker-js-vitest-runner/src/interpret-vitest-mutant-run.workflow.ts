import { Workflow } from '@systemfsoftware/effect-cell-types'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { VitestMutantRunCommand } from './vitest-run-command.schema.js'

const HIT_LIMIT_REASON_PREFIX = 'Hit limit reached'
const hitLimitReachedReason = (count: number, limit: number): string => `${HIT_LIMIT_REASON_PREFIX} (${count}/${limit})`

const normalizedPath = (path: string): string => path.replaceAll('\\', '/')

const fileTrapMatches = (command: VitestMutantRunCommand, trapFile: string): boolean => {
  const normalizedFile = normalizedPath(command.activeMutantFileName)
  const needle = normalizedPath(trapFile)
  return Boolean.match(normalizedFile === needle, {
    onTrue: () => true,
    onFalse: () => normalizedFile.endsWith(`/${needle}`),
  })
}

const isNamedTrap = (command: VitestMutantRunCommand): boolean =>
  Option.isSome(
    Option.orElse(
      Option.filter(
        Option.fromNullishOr(command.timeoutTrapMutantId),
        (trapId) => trapId === command.activeMutantId,
      ),
      () =>
        Option.flatMap(
          Option.filter(Option.fromNullishOr(command.timeoutTrapFile), (trapFile) => trapFile.length > 0),
          (trapFile) => Option.liftPredicate(command.activeMutantId, () => fileTrapMatches(command, trapFile)),
        ),
    ),
  )

const VitestMutantRunTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-vitest-runner/VitestMutantRun')
type VitestMutantRunTypeId = typeof VitestMutantRunTypeId

export class MutantKilled extends S.TaggedClass<MutantKilled>()('Killed', {
  tests: S.Array(TestRunner.TestResultSchema),
  killerIds: S.String.pipe(S.Array, S.optional),
  failureMessage: S.optional(S.String),
}) {
  readonly [VitestMutantRunTypeId] = VitestMutantRunTypeId
}

export class MutantSurvived extends S.TaggedClass<MutantSurvived>()('Survived', {
  tests: S.Array(TestRunner.TestResultSchema),
}) {
  readonly [VitestMutantRunTypeId] = VitestMutantRunTypeId
}

export class MutantTimeout extends S.TaggedClass<MutantTimeout>()('Timeout', {
  tests: S.Array(TestRunner.TestResultSchema),
  reason: S.optional(S.String),
}) {
  readonly [VitestMutantRunTypeId] = VitestMutantRunTypeId
}

export class MutantDryError extends S.TaggedClass<MutantDryError>()('Error', {
  tests: S.Array(TestRunner.TestResultSchema),
  errorMessage: S.optional(S.String),
}) {
  readonly [VitestMutantRunTypeId] = VitestMutantRunTypeId
}

export type VitestMutantRunOutput = MutantKilled | MutantSurvived | MutantTimeout | MutantDryError

const hitLimitReason = (hitCount: number | undefined, hitLimit: number | undefined): Option.Option<string> =>
  Option.flatMap(
    Option.fromNullishOr(hitCount),
    (count) =>
      Option.flatMap(Option.fromNullishOr(hitLimit), (limit) =>
        Boolean.match(count > limit, {
          onTrue: (): Option.Option<string> => Option.some(hitLimitReachedReason(count, limit)),
          onFalse: (): Option.Option<string> => Option.none(),
        })),
  )

const killedFrom = (
  command: VitestMutantRunCommand,
  killed: readonly TestRunner.FailedTestResult[],
): VitestMutantRunOutput => {
  const firstKiller = Option.fromUndefinedOr(killed[0])
  const failureMessage = Option.getOrUndefined(Option.map(firstKiller, (killer) => killer.failureMessage))
  return Boolean.match(command.reportAllKillers, {
    onTrue: (): VitestMutantRunOutput =>
      MutantKilled.make({ tests: command.tests, killerIds: killed.map((test) => test.id), failureMessage }),
    onFalse: (): VitestMutantRunOutput =>
      MutantKilled.make({
        tests: command.tests,
        killerIds: Option.match(firstKiller, {
          onNone: (): readonly string[] | undefined => undefined,
          onSome: (killer): readonly string[] => [killer.id],
        }),
        failureMessage,
      }),
  })
}

const decideFromTests = (command: VitestMutantRunCommand): VitestMutantRunOutput => {
  const killed = command.tests.filter((test) => test.status === 'failed')
  return Boolean.match(killed.length > 0, {
    onTrue: (): VitestMutantRunOutput => killedFrom(command, killed),
    onFalse: (): VitestMutantRunOutput =>
      Boolean.match(command.hasExternalError, {
        onTrue: (): VitestMutantRunOutput =>
          MutantDryError.make({
            tests: [],
            errorMessage: `An error occurred outside of a test run: ${command.externalErrorText}`,
          }),
        onFalse: (): VitestMutantRunOutput => MutantSurvived.make({ tests: command.tests }),
      }),
  })
}

const decideVitestMutantRun = (command: VitestMutantRunCommand) =>
  Option.match(hitLimitReason(command.hitCount, command.hitLimit), {
    onSome: (hit) =>
      Boolean.match(isNamedTrap(command), {
        onTrue: (): Result.Result<VitestMutantRunOutput, never> =>
          Result.succeed(MutantTimeout.make({ tests: [], reason: hit })),
        onFalse: (): Result.Result<VitestMutantRunOutput, never> =>
          Result.succeed(MutantKilled.make({ tests: [], failureMessage: hit })),
      }),
    onNone: (): Result.Result<VitestMutantRunOutput, never> => Result.succeed(decideFromTests(command)),
  })

export const interpretVitestMutantRun = Workflow.make({
  command: VitestMutantRunCommand,
  decision: S.Union([MutantKilled, MutantSurvived, MutantTimeout, MutantDryError]),
  error: S.Never,
  decide: decideVitestMutantRun,
})
