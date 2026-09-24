import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  interpretVitestMutantRun,
  MutantDryError,
  MutantKilled,
  MutantSurvived,
  MutantTimeout,
} from '../interpret-vitest-mutant-run.workflow.js'
import { VitestMutantRunCommand } from '../vitest-run-command.schema.js'

const VITEST_MUTANT_RUN_FAMILY = Symbol.for('@systemfsoftware/stryker-js-vitest-runner/VitestMutantRun')

const carriesFamilyBrand = (decision: object): boolean =>
  Reflect.get(decision, VITEST_MUTANT_RUN_FAMILY) === VITEST_MUTANT_RUN_FAMILY

const commandWith = (
  input: VitestMutantRunCommand,
  override: {
    readonly tests?: readonly TestRunner.TestResult[]
    readonly hasExternalError?: boolean
    readonly externalErrorText?: string
    readonly hitCount: number | undefined
    readonly hitLimit: number | undefined
    readonly reportAllKillers?: boolean
    readonly activeMutantId?: string
    readonly namedTrapId?: string | undefined
  },
): VitestMutantRunCommand =>
  VitestMutantRunCommand.make({
    tests: override.tests ?? [...input.tests],
    hasExternalError: override.hasExternalError ?? input.hasExternalError,
    externalErrorText: override.externalErrorText ?? input.externalErrorText,
    hitCount: override.hitCount,
    hitLimit: override.hitLimit,
    reportAllKillers: override.reportAllKillers ?? input.reportAllKillers,
    activeMutantId: override.activeMutantId ?? input.activeMutantId,
    namedTrapId: override.namedTrapId ?? input.namedTrapId,
  })

const testsIn = (
  tests: readonly TestRunner.TestResult[],
): { readonly ids: readonly string[]; readonly failed: readonly string[] } => ({
  ids: tests.map((test) => test.id),
  failed: tests.filter((test) => test.status === 'failed').map((test) => test.id),
})

describe('interpretVitestMutantRun', () => {
  it.prop(
    '→h_HitLimitOnNamedTrap_=Timeout',
    [
      VitestMutantRunCommand,
      S.Int.check(S.isBetween({ minimum: 0, maximum: 100000 })),
      S.Int.check(S.isBetween({ minimum: 1, maximum: 100 })),
    ],
    ([input, hitLimit, extra]) => {
      const hitCount = hitLimit + extra
      const result = interpretVitestMutantRun(commandWith(input, {
        hitCount,
        hitLimit,
        activeMutantId: input.activeMutantId,
        namedTrapId: input.activeMutantId,
      }))
      if (!Result.isSuccess(result)) {
        return false
      }
      if (!S.is(MutantTimeout)(result.success)) {
        return false
      }
      const timeout = result.success
      const reasonReached = Result.match(
        S.encodeResult(TestRunner.HitLimitReason)({ count: hitCount, limit: hitLimit }),
        {
          onFailure: () => false,
          onSuccess: (reason) => timeout.reason === reason,
        },
      )
      const reasonPrefixed = result.success.reason !== undefined &&
        result.success.reason.startsWith(TestRunner.HitLimitReasonPrefix.literal)
      return carriesFamilyBrand(result.success) && result.success.tests.length === 0 && reasonReached && reasonPrefixed
    },
  )

  it.prop(
    '→h_HitLimitOnOtherMutant_=Killed',
    [
      VitestMutantRunCommand,
      S.Int.check(S.isBetween({ minimum: 0, maximum: 100000 })),
      S.Int.check(S.isBetween({ minimum: 1, maximum: 100 })),
    ],
    ([input, hitLimit, extra]) => {
      const hitCount = hitLimit + extra
      const result = interpretVitestMutantRun(commandWith(input, {
        hitCount,
        hitLimit,
        activeMutantId: `${input.activeMutantId}-finite`,
        namedTrapId: input.activeMutantId,
      }))
      if (!Result.isSuccess(result)) {
        return false
      }
      return S.is(MutantKilled)(result.success) && !S.is(MutantTimeout)(result.success)
    },
  )

  it.prop(
    '→h_HitCountAtBound_≠Timeout',
    [
      VitestMutantRunCommand,
      S.Int.check(S.isBetween({ minimum: 0, maximum: 100000 })),
    ],
    ([input, hitLimit]) => {
      const result = interpretVitestMutantRun(commandWith(input, {
        hitCount: hitLimit,
        hitLimit,
        activeMutantId: input.activeMutantId,
        namedTrapId: input.activeMutantId,
      }))
      if (!Result.isSuccess(result)) {
        return false
      }
      return !S.is(MutantTimeout)(result.success)
    },
  )

  it.prop(
    '→f_FailedTestPlusHitBound_=Killed',
    [
      VitestMutantRunCommand,
      S.Int.check(S.isBetween({ minimum: 0, maximum: 1000 })),
      S.Int.check(S.isBetween({ minimum: 1, maximum: 100 })),
    ],
    ([input, hitLimit, extra]) => {
      const failed: TestRunner.FailedTestResult = {
        id: 'a.ts#fails',
        name: 'fails',
        timeSpentMs: 1,
        status: 'failed',
        failureMessage: 'boom',
      }
      const result = interpretVitestMutantRun(commandWith(input, {
        tests: [failed],
        hitCount: hitLimit + extra,
        hitLimit,
        activeMutantId: `${input.activeMutantId}-finite`,
        namedTrapId: input.activeMutantId,
      }))
      if (!Result.isSuccess(result)) {
        return false
      }
      return S.is(MutantKilled)(result.success) && !S.is(MutantTimeout)(result.success)
    },
  )

  it.prop(
    '→e_ExternalErrorAlone_=DryError',
    [VitestMutantRunCommand],
    ([input]) => {
      const result = interpretVitestMutantRun(
        commandWith(input, {
          tests: [],
          hasExternalError: true,
          hitCount: undefined,
          hitLimit: undefined,
        }),
      )
      if (!Result.isSuccess(result)) {
        return false
      }
      if (!S.is(MutantDryError)(result.success)) {
        return false
      }
      return (
        carriesFamilyBrand(result.success) &&
        result.success.tests.length === 0 &&
        result.success.errorMessage === `An error occurred outside of a test run: ${input.externalErrorText}`
      )
    },
  )

  it.prop(
    '→t_FailedTest_=Killed',
    [
      VitestMutantRunCommand,
      S.String.check(S.isMinLength(1), S.isMaxLength(24)),
      S.String.check(S.isMaxLength(32)),
    ],
    ([input, name, message]) => {
      const failed: TestRunner.FailedTestResult = {
        id: `tests/a.spec.ts#${name}`,
        name,
        timeSpentMs: 5,
        status: 'failed',
        failureMessage: message,
        fileName: 'tests/a.spec.ts',
      }
      const result = interpretVitestMutantRun(
        commandWith(input, {
          tests: [failed],
          hasExternalError: false,
          hitCount: undefined,
          hitLimit: undefined,
        }),
      )
      if (!Result.isSuccess(result)) {
        return false
      }
      if (!S.is(MutantKilled)(result.success)) {
        return false
      }
      if (!carriesFamilyBrand(result.success)) {
        return false
      }
      const tests = testsIn(result.success.tests)
      const killerIds = result.success.killerIds
      return (
        tests.failed.length === 1 &&
        killerIds !== undefined &&
        killerIds.length === 1 &&
        killerIds[0] === tests.failed[0] &&
        result.success.failureMessage === message
      )
    },
  )

  it.prop(
    '→t_PassedTest_=Survived',
    [VitestMutantRunCommand, S.String.check(S.isMinLength(1), S.isMaxLength(24))],
    ([input, name]) => {
      const passed: TestRunner.TestResult = {
        id: `tests/a.spec.ts#${name}`,
        name,
        timeSpentMs: 3,
        status: 'success',
        fileName: 'tests/a.spec.ts',
      }
      const result = interpretVitestMutantRun(
        commandWith(input, {
          tests: [passed],
          hasExternalError: false,
          hitCount: undefined,
          hitLimit: undefined,
        }),
      )
      if (!Result.isSuccess(result)) {
        return false
      }
      if (!S.is(MutantSurvived)(result.success)) {
        return false
      }
      if (!carriesFamilyBrand(result.success)) {
        return false
      }
      const tests = testsIn(result.success.tests)
      return tests.ids.length === 1 && tests.failed.length === 0
    },
  )

  const SUITE_NAME = S.String.check(S.isMinLength(1), S.isMaxLength(12), S.isPattern(/^[^#]+$/))
  interface SuiteLink {
    readonly name: string
    readonly suite?: SuiteLink
  }
  const nestedTaskArb = Arbitrary.all({
    suites: Arbitrary.array(Arbitrary.schema(SUITE_NAME), { minLength: 1, maxLength: 2 }),
    name: Arbitrary.schema(SUITE_NAME),
    fullTestName: Arbitrary.schema(SUITE_NAME),
  })

  const PROJECT_ROOT = '/project'

  const runCommandPayload = (
    input: VitestMutantRunCommand,
    task: { readonly name: string; readonly fullTestName: string; readonly suite: SuiteLink | undefined },
  ) => ({
    _tag: 'VitestMutantRunCommand' as const,
    tests: {
      projectRoot: PROJECT_ROOT,
      records: [{
        ...task,
        result: { state: 'fail', duration: 5, errors: [{ message: 'boom' }] },
        file: { filepath: `${PROJECT_ROOT}/tests/a.spec.ts` },
      }],
    },
    hasExternalError: false,
    externalErrorText: input.externalErrorText,
    hitCount: undefined,
    hitLimit: undefined,
    reportAllKillers: input.reportAllKillers,
    activeMutantId: input.activeMutantId,
    namedTrapId: input.namedTrapId,
  })

  it.prop(
    '→t_KillerId_≡vitestFullTestName',
    [VitestMutantRunCommand, nestedTaskArb],
    ([input, { suites, name, fullTestName }]) => {
      const suiteChain = suites.reduceRight<SuiteLink | undefined>(
        (child, suiteName) => ({ name: suiteName, suite: child }),
        undefined,
      )
      return Result.match(
        S.decodeResult(VitestMutantRunCommand)(runCommandPayload(input, { name, fullTestName, suite: suiteChain })),
        {
          onFailure: () => false,
          onSuccess: (command) => {
            const result = interpretVitestMutantRun(command)
            if (!Result.isSuccess(result) || !S.is(MutantKilled)(result.success)) {
              return false
            }
            const killerIds = result.success.killerIds
            return killerIds !== undefined &&
              killerIds.length === 1 &&
              killerIds[0] === `tests/a.spec.ts#${fullTestName}`
          },
        },
      )
    },
  )
})
