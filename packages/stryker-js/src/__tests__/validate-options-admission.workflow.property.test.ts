import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  OptionsRefused,
  OptionsValidated,
  type OptionsValidationDecision,
  validateOptionsAdmission,
  ValidateOptionsCommand,
} from '../run/validate-options-admission.workflow.js'

const REMOVED_OPTION_WARNING =
  'Removed stryker config option "incrementalSources" (removed-option): verdicts are now read from the verdict store; delete the option and set "verdictStore" to share verdicts between runs, shards or machines.'

const commandOf = <A>(options: Record<string, A>): ValidateOptionsCommand =>
  ValidateOptionsCommand.make({ options, schema: {} })

const decide = <A>(subject: typeof validateOptionsAdmission, options: Record<string, A>) =>
  subject(commandOf(options)).pipe(Result.getOrElse((neverError) => neverError))

const refusedWith = (decision: OptionsValidationDecision, fragment: string): boolean =>
  S.is(OptionsRefused)(decision) && decision.errors.some((error) => error.includes(fragment))

const rangeArb = Arbitrary.schema(S.Struct({
  startLine: S.Int.check(S.isBetween({ minimum: 0, maximum: 8 })),
  endLine: S.Int.check(S.isBetween({ minimum: 0, maximum: 8 })),
}))
const ignoreStaticArb = Arbitrary.schema(S.Struct({ ignoreStatic: S.Boolean, perTest: S.Boolean }))
const globArb = Arbitrary.schema(S.Struct({
  globChar: S.optional(S.Literals(['*', '?', '[', '{'])),
  name: S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,4}$/)),
}))

describe('validateOptionsAdmission', () => {
  it.prop(
    '∀m_Mutate_≡RangeBoundsAreEnforced',
    { of: [rangeArb], subject: validateOptionsAdmission },
    (subject, [{ startLine, endLine }]) => {
      const decision = decide(
        subject,
        {
          mutate: [`src/a.ts:${startLine}-${endLine}`],
          ignoreStatic: false,
          coverageAnalysis: 'perTest',
        },
      )
      if (startLine < 1) {
        return refusedWith(decision, 'does not exist')
      }
      if (startLine > endLine) {
        return refusedWith(decision, 'should be less')
      }
      return S.is(OptionsValidated)(decision)
    },
  )

  it.prop(
    '∀g_Glob_≡GlobAndRangeAreExclusive',
    { of: [globArb], subject: validateOptionsAdmission },
    (subject, [{ globChar, name }]) => {
      const decision = decide(
        subject,
        {
          mutate: [`src/${name}${globChar ?? ''}.ts:1-2`],
          ignoreStatic: false,
          coverageAnalysis: 'perTest',
        },
      )
      return globChar === undefined
        ? S.is(OptionsValidated)(decision)
        : refusedWith(decision, 'Cannot combine a glob expression')
    },
  )

  it.prop(
    '∀c_Coverage_≡IgnoreStaticImpliesPerTest',
    { of: [ignoreStaticArb], subject: validateOptionsAdmission },
    (subject, [{ ignoreStatic, perTest }]) => {
      const decision = decide(
        subject,
        { mutate: [], ignoreStatic, coverageAnalysis: perTest ? 'perTest' : 'all' },
      )
      return ignoreStatic && perTest === false
        ? refusedWith(decision, 'ignoreStatic')
        : S.is(OptionsValidated)(decision)
    },
  )

  it.prop(
    '∀op_RemovedOption_≡IncrementalSourcesAlwaysWarnsWithCodeAndNextAction',
    { of: [S.Boolean, S.Boolean], subject: validateOptionsAdmission },
    (subject, [unknownOptions, present]) => {
      const config = {
        mutate: [],
        ignoreStatic: false,
        coverageAnalysis: 'perTest',
        warnings: { unknownOptions },
      }
      const decision = decide(
        subject,
        present ? { ...config, incrementalSources: ['reports/other-shard.json'] } : config,
      )
      return S.is(OptionsValidated)(decision) &&
        decision.warnings.includes(REMOVED_OPTION_WARNING) === present &&
        decision.warnings.includes('Unknown stryker config option "incrementalSources".') === false
    },
  )

  it.prop(
    '∀u_UnknownOption_≡OtherUnknownOptionsStillWarnWhenRequested',
    { of: [S.Boolean], subject: validateOptionsAdmission },
    (subject, [unknownOptions]) => {
      const decision = decide(subject, {
        mutate: [],
        ignoreStatic: false,
        coverageAnalysis: 'perTest',
        warnings: { unknownOptions },
        mysteryOption: 1,
      })
      return S.is(OptionsValidated)(decision) &&
        decision.warnings.some((warning) => warning.includes('"mysteryOption"')) === unknownOptions
    },
  )
})
