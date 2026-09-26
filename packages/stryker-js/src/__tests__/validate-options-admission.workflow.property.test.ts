import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  OptionsRefused,
  OptionsUndecodable,
  OptionsValidated,
  type OptionsValidationDecision,
  validateOptionsAdmission,
  ValidateOptionsCommand,
} from '../run/validate-options-admission.workflow.js'

const commandOf = <A>(options: Record<string, A>): ValidateOptionsCommand =>
  ValidateOptionsCommand.make({ options, schema: {} })

const decide = <A>(subject: typeof validateOptionsAdmission, options: Record<string, A>) =>
  subject(commandOf(options)).pipe(Result.getOrElse((neverError) => neverError))

const refusedWith = (decision: OptionsValidationDecision, fragment: string): boolean =>
  S.is(OptionsRefused)(decision) && decision.errors.some((error) => error.includes(fragment))

const mutateArb = Arbitrary.schema(S.Struct({ outOfBounds: S.Boolean }))
const ignoreStaticArb = Arbitrary.schema(S.Struct({ ignoreStatic: S.Boolean, perTest: S.Boolean }))
const globArb = Arbitrary.schema(S.Struct({ glob: S.Boolean }))
const thresholdArb = Arbitrary.schema(S.Struct({ malformed: S.Boolean, high: S.Int }))

describe('validateOptionsAdmission', () => {
  it.prop(
    '∀m_Mutate_≡OutOfBoundsRangesAreRefused',
    { of: [mutateArb], subject: validateOptionsAdmission },
    (subject, [{ outOfBounds }]) => {
      const decision = decide(
        subject,
        { mutate: [outOfBounds ? 'src/a.ts:0-0' : 'src/a.ts:1-2'], ignoreStatic: false, coverageAnalysis: 'perTest' },
      )
      return outOfBounds
        ? refusedWith(decision, 'does not exist')
        : S.is(OptionsValidated)(decision)
    },
  )

  it.prop(
    '∀g_Glob_≡GlobAndRangeAreExclusive',
    { of: [globArb], subject: validateOptionsAdmission },
    (subject, [{ glob }]) => {
      const decision = decide(
        subject,
        { mutate: [glob ? 'src/*.ts:1-2' : 'src/a.ts:1-2'], ignoreStatic: false, coverageAnalysis: 'perTest' },
      )
      return glob
        ? refusedWith(decision, 'Cannot combine a glob expression')
        : S.is(OptionsValidated)(decision)
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
    '∀t_Threshold_≡MalformedThresholdsAreUndecodable',
    { of: [thresholdArb], subject: validateOptionsAdmission },
    (subject, [{ malformed, high }]) => {
      if (malformed) {
        const decision = decide(subject, { mutate: [], thresholds: { high, low: 'not-a-number' } })
        return S.is(OptionsUndecodable)(decision)
      }
      const decision = decide(subject, { mutate: [], ignoreStatic: false, coverageAnalysis: 'perTest' })
      return S.is(OptionsValidated)(decision)
    },
  )
})
