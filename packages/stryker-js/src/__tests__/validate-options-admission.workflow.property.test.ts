import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { forkOptionsSchema } from '../Config.schema.js'
import {
  OptionsRefused,
  OptionsValidated,
  type OptionsValidationDecision,
  validateOptionsAdmission,
  ValidateOptionsCommand,
  type ValidationSchemaDocument,
} from '../run/validate-options-admission.workflow.js'

const CORE_SCHEMA_DOCUMENT: ValidationSchemaDocument = S.toJsonSchemaDocument(forkOptionsSchema).schema

const commandOf = <A>(
  options: Record<string, A>,
  schema: ValidationSchemaDocument = {},
): ValidateOptionsCommand => ValidateOptionsCommand.make({ options, schema })

const decide = <A>(
  subject: typeof validateOptionsAdmission,
  options: Record<string, A>,
  schema?: ValidationSchemaDocument,
) => subject(commandOf(options, schema)).pipe(Result.getOrElse((neverError) => neverError))

const refusedWith = (decision: OptionsValidationDecision, fragment: string): boolean =>
  S.is(OptionsRefused)(decision) && decision.errors.some((error) => error.includes(fragment))

const warningsIn = (decision: OptionsValidationDecision): readonly string[] =>
  Match.valueTags(decision, {
    OptionsRefused: (refused) => refused.warnings,
    OptionsUndecodable: (undecodable) => undecodable.warnings,
    OptionsValidated: (validated) => validated.warnings,
  })

const hasUnknownOptionWarning = (warnings: readonly string[]): boolean =>
  warnings.some((warning) => warning.includes('Unknown stryker config option') || warning.includes('Possible causes'))

const rangeArb = Arbitrary.schema(S.Struct({
  startLine: S.Int.check(S.isBetween({ minimum: 0, maximum: 8 })),
  endLine: S.Int.check(S.isBetween({ minimum: 0, maximum: 8 })),
}))
const ignoreStaticArb = Arbitrary.schema(S.Struct({ ignoreStatic: S.Boolean, perTest: S.Boolean }))
const globArb = Arbitrary.schema(S.Struct({
  globChar: S.optional(S.Literals(['*', '?', '[', '{'])),
  name: S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,4}$/)),
}))

const unknownOptionArb = Arbitrary.schema(S.Struct({
  include: S.Boolean,
  name: S.String.check(S.isPattern(/^k[a-z0-9]{0,4}$/)),
}))

const optionsWith = (include: boolean, name: string): Record<string, boolean | number> => {
  const known: Record<string, boolean | number> = { warnings: true }
  return include ? { ...known, [name]: 42 } : known
}

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
    '∀k_Included_≡UnknownOptionIsWarnedExactlyWhenTheSchemaOmitsIt',
    { of: [unknownOptionArb], subject: validateOptionsAdmission },
    (subject, [{ include, name }]) => {
      const decision = decide(subject, optionsWith(include, name), CORE_SCHEMA_DOCUMENT)
      const warnings = warningsIn(decision)
      const namesTheOption = warnings.some((warning) => warning.includes(`Unknown stryker config option "${name}".`))
      return namesTheOption === include && hasUnknownOptionWarning(warnings) === include
    },
  )
})
