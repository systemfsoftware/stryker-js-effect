import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  interpretVitestMutantRun,
  MutantDryError,
  MutantKilled,
  MutantSurvived,
  MutantTimeout,
} from '../interpret-vitest-mutant-run.workflow.js'
import { VitestMutantRunCommand } from '../vitest-run-command.schema.js'

const TRAP_MUTANT_ID = Mutant.MutantId.make('0')
const OTHER_MUTANT_ID = Mutant.MutantId.make('1')
const TRAP_FILE = 'b.ts'

const commandWith = (
  input: VitestMutantRunCommand,
  override: {
    readonly tests?: readonly TestRunner.TestResult[]
    readonly hasExternalError?: boolean
    readonly externalErrorText?: string
    readonly hitCount?: number
    readonly hitLimit?: number
    readonly activeMutantId?: Mutant.MutantId
    readonly activeMutantFileName?: string
    readonly timeoutTrapFile?: string
    readonly timeoutTrapMutantId?: Mutant.MutantId
  },
): VitestMutantRunCommand =>
  VitestMutantRunCommand.make({
    tests: override.tests ?? input.tests,
    hasExternalError: override.hasExternalError ?? input.hasExternalError,
    externalErrorText: override.externalErrorText ?? input.externalErrorText,
    hitCount: override.hitCount ?? input.hitCount,
    hitLimit: override.hitLimit ?? input.hitLimit,
    reportAllKillers: input.reportAllKillers,
    activeMutantId: override.activeMutantId ?? input.activeMutantId,
    activeMutantFileName: Mutant.CanonicalFileName.make(override.activeMutantFileName ?? input.activeMutantFileName),
    timeoutTrapFile: override.timeoutTrapFile ?? input.timeoutTrapFile,
    timeoutTrapMutantId: override.timeoutTrapMutantId ?? input.timeoutTrapMutantId,
  })

describe('interpretVitestMutantRun', (it) => {
  it.prop(
    '→h_HitLimitOnNamedTrap_=Timeout',
    { of: [VitestMutantRunCommand], subject: interpretVitestMutantRun },
    (subject, [input]) => {
      const hitLimit = input.hitLimit ?? 0
      const hitCount = hitLimit + 1
      const command = commandWith(input, { hitCount, hitLimit, timeoutTrapMutantId: input.activeMutantId })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) =>
          S.is(MutantTimeout)(outcome) &&
          outcome.tests.length === 0 &&
          outcome.reason ===
            Result.getOrElse(S.encodeResult(TestRunner.HitLimitReason)({ count: hitCount, limit: hitLimit }), () =>
              '') &&
          outcome.reason.startsWith(TestRunner.HitLimitReasonPrefix.literal),
      })
    },
  )

  it.prop(
    '→h_HitLimitOnTrapFile_=Timeout',
    { of: [VitestMutantRunCommand], subject: interpretVitestMutantRun },
    (subject, [input]) => {
      const hitLimit = input.hitLimit ?? 0
      const command = commandWith(input, {
        hitCount: hitLimit + 1,
        hitLimit,
        activeMutantFileName: 'tests/a.ts',
        timeoutTrapFile: 'a.ts',
      })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) => S.is(MutantTimeout)(outcome) && outcome.tests.length === 0,
      })
    },
  )

  it.prop(
    '→h_HitLimitOnOtherMutant_=Killed',
    { of: [VitestMutantRunCommand], subject: interpretVitestMutantRun },
    (subject, [input]) => {
      const hitLimit = input.hitLimit ?? 0
      const command = commandWith(input, {
        hitCount: hitLimit + 1,
        hitLimit,
        activeMutantId: TRAP_MUTANT_ID,
        activeMutantFileName: 'tests/a.ts',
        timeoutTrapFile: TRAP_FILE,
        timeoutTrapMutantId: OTHER_MUTANT_ID,
      })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) =>
          S.is(MutantKilled)(outcome) && !S.is(MutantTimeout)(outcome) && outcome.tests.length === 0,
      })
    },
  )

  it.prop(
    '→h_HitCountAtBound_≠Timeout',
    { of: [VitestMutantRunCommand], subject: interpretVitestMutantRun },
    (subject, [input]) => {
      const hitLimit = input.hitLimit ?? 0
      const command = commandWith(input, {
        hitCount: hitLimit,
        hitLimit,
        timeoutTrapMutantId: input.activeMutantId,
      })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) => !S.is(MutantTimeout)(outcome),
      })
    },
  )

  it.prop(
    '→f_FailedTestPlusHitBound_=Killed',
    { of: [VitestMutantRunCommand, TestRunner.TestResultSchema], subject: interpretVitestMutantRun },
    (subject, [input, test]) => {
      const hitLimit = input.hitLimit ?? 0
      const command = commandWith(input, {
        tests: [test],
        hitCount: hitLimit + 1,
        hitLimit,
        activeMutantId: TRAP_MUTANT_ID,
        activeMutantFileName: 'tests/a.ts',
        timeoutTrapFile: TRAP_FILE,
        timeoutTrapMutantId: OTHER_MUTANT_ID,
      })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) => S.is(MutantKilled)(outcome) && outcome.tests.length === 0,
      })
    },
  )

  it.prop(
    '∀t_TestResult_≡KilledIffFailed',
    { of: [VitestMutantRunCommand, TestRunner.TestResultSchema], subject: interpretVitestMutantRun },
    (subject, [input, test]) => {
      const command = commandWith(input, {
        tests: [test],
        hasExternalError: false,
        hitCount: 0,
        hitLimit: 0,
      })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) =>
          test.status === 'failed'
            ? S.is(MutantKilled)(outcome) &&
              outcome.killerIds?.includes(test.id) === true &&
              outcome.failureMessage === test.failureMessage
            : S.is(MutantSurvived)(outcome),
      })
    },
  )

  it.prop(
    '∀c_MutantRunCommand_≡DryErrorNamesTheExternalError',
    {
      of: [VitestMutantRunCommand, S.String.check(S.isMinLength(1), S.isMaxLength(32))],
      subject: interpretVitestMutantRun,
    },
    (subject, [input, externalErrorText]) => {
      const command = commandWith(input, {
        tests: [],
        hasExternalError: true,
        externalErrorText,
        hitCount: 0,
        hitLimit: 0,
      })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) =>
          S.is(MutantDryError)(outcome) &&
          outcome.errorMessage === `An error occurred outside of a test run: ${externalErrorText}`,
      })
    },
  )
})
