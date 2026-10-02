import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
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

const TRAP_MUTANT_ID = Mutant.MutantId.make('0000000000000000')
const OTHER_MUTANT_ID = Mutant.MutantId.make('0000000000000001')
const TRAP_FILE = 'b.ts'

const holds = (conditions: readonly boolean[]): boolean => conditions.every((condition) => condition)

type MutantRunCoverValue = VitestMutantRunCommand | TestRunner.TestResult | string

const isTestResult = (value: MutantRunCoverValue): value is TestRunner.TestResult =>
  typeof value === 'object' && 'status' in value

const isCommand = (value: MutantRunCoverValue): value is VitestMutantRunCommand =>
  typeof value === 'object' && ('status' in value) === false

const commandOf = (value: MutantRunCoverValue): VitestMutantRunCommand | undefined =>
  isCommand(value) ? value : undefined

const limitOf = (value: MutantRunCoverValue): number => commandOf(value)?.hitLimit ?? 0

const externalError = (value: MutantRunCoverValue): boolean => commandOf(value)?.hasExternalError === true

const testsOf = (value: MutantRunCoverValue): readonly TestRunner.TestResult[] => commandOf(value)?.tests ?? []

const anyFailedTest = (tests: readonly TestRunner.TestResult[]): boolean =>
  tests.some((test) => test.status === 'failed')

const anySkippedTest = (tests: readonly TestRunner.TestResult[]): boolean =>
  tests.some((test) => test.status === 'skipped')

const statusOf = (value: MutantRunCoverValue): TestRunner.TestStatus | undefined =>
  isTestResult(value) ? value.status : undefined

const textCharacterArb = Arbitrary.schema(S.Literals(['a', 'b', 'x', '1', '-', ' ']))

const errorTextArb: Arbitrary.Arbitrary<string> = Arbitrary.schema(
  S.Int.check(S.isBetween({ minimum: 1, maximum: 32 })),
).pipe(
  Arbitrary.flatMap((length) => Arbitrary.array(textCharacterArb, { minLength: length, maxLength: length })),
  Arbitrary.map((characters) => characters.join('')),
)

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
    {
      of: [VitestMutantRunCommand],
      subject: interpretVitestMutantRun,
      cover: {
        hitLimitAtZero: [(input) => limitOf(input) === 0, 0.2],
        hitLimitPositive: [(input) => limitOf(input) > 0, 0.05],
      },
    },
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
    {
      of: [VitestMutantRunCommand],
      subject: interpretVitestMutantRun,
      cover: {
        hitLimitAtZero: [(input) => limitOf(input) === 0, 0.2],
        hitLimitPositive: [(input) => limitOf(input) > 0, 0.05],
      },
    },
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
    {
      of: [VitestMutantRunCommand],
      subject: interpretVitestMutantRun,
      cover: {
        hitLimitAtZero: [(input) => limitOf(input) === 0, 0.2],
        hitLimitPositive: [(input) => limitOf(input) > 0, 0.05],
      },
    },
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
    {
      of: [VitestMutantRunCommand],
      subject: interpretVitestMutantRun,
      cover: {
        noHitKilled: [(input) => anyFailedTest(testsOf(input)), 0.2],
        noHitExternalError: [(input) => holds([anyFailedTest(testsOf(input)) === false, externalError(input)]), 0.05],
        noHitSurvived: [
          (input) => holds([anyFailedTest(testsOf(input)) === false, externalError(input) === false]),
          0.05,
        ],
      },
    },
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
    {
      of: [VitestMutantRunCommand, TestRunner.TestResultSchema],
      subject: interpretVitestMutantRun,
      cover: {
        hitLimitAtZero: [(input) => limitOf(input) === 0, 0.2],
        hitLimitPositive: [(input) => limitOf(input) > 0, 0.05],
      },
    },
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
    {
      of: [VitestMutantRunCommand, TestRunner.TestResultSchema],
      subject: interpretVitestMutantRun,
      cover: {
        failedTest: [(_input, test) => statusOf(test) === 'failed', 0.1],
        skippedTest: [(_input, test) => statusOf(test) === 'skipped', 0.1],
        successTest: [(_input, test) => statusOf(test) === 'success', 0.1],
      },
    },
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
      of: [VitestMutantRunCommand, errorTextArb],
      subject: interpretVitestMutantRun,
      cover: {
        shortExternalErrorText: [(_input, text) => typeof text === 'string' && text.length <= 16, 0.2],
        longExternalErrorText: [(_input, text) => typeof text === 'string' && text.length > 16, 0.1],
      },
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

  it.prop(
    '∀c_MutantRunCommand_≡ScorableOutcomesReportEveryExecutedTest',
    {
      of: [VitestMutantRunCommand],
      subject: interpretVitestMutantRun,
      cover: {
        anyFailedTest: [(input) => anyFailedTest(testsOf(input)), 0.2],
        noFailedTest: [(input) => anyFailedTest(testsOf(input)) === false, 0.05],
        anySkippedTest: [(input) => anySkippedTest(testsOf(input)), 0.2],
      },
    },
    (subject, [input]) => {
      const command = commandWith(input, {
        tests: input.tests,
        hasExternalError: false,
        hitCount: 0,
        hitLimit: 0,
      })
      const ran = command.tests.filter((test) => test.status !== 'skipped')
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) =>
          (S.is(MutantKilled)(outcome) || S.is(MutantSurvived)(outcome)) &&
          outcome.executedTests.length === ran.length &&
          outcome.executedTests.every((executed, index) =>
            executed.id === ran.at(index)?.id && executed.timeSpentMs === ran.at(index)?.timeSpentMs
          ),
      })
    },
  )
})
