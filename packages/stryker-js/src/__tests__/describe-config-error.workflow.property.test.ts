import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  ConfigErrorDescribed,
  ConfigErrorUnparsed,
  describeConfigError,
  DescribeConfigErrorCommand,
} from '../run/describe-config-error.workflow.js'

const errorsArb = Arbitrary.schema(S.Array(S.String))

const issueArb = Arbitrary.schema(
  S.Struct({
    segment: S.String.check(S.isPattern(/^[a-z]{1,5}$/)),
    issue: S.String.check(S.isPattern(/^[a-z]{1,10}$/)),
  }),
)

const blankArb = Arbitrary.schema(S.String.check(S.isPattern(/^\s*$/)))

describe('describeConfigError', () => {
  it.prop(
    '∀es_Errors_≡GivenErrorsAreKeptAndHeadlined',
    { of: [errorsArb], subject: describeConfigError },
    (subject, [errors]) => {
      const decision = subject(DescribeConfigErrorCommand.make({ errors })).pipe(
        Result.getOrElse((neverError) => neverError),
      )
      const headline = errors.length === 1
        ? 'Please correct this configuration error and try again.'
        : 'Please correct these configuration errors and try again.'
      return S.is(ConfigErrorDescribed)(decision) &&
        decision.errors.join('\u0000') === errors.join('\u0000') &&
        decision.text === `${headline} ${errors.join(' ')}`
    },
  )

  it.prop(
    '∀m_Message_≡NestedPathNamesEverySegmentInOrder',
    { of: [issueArb], subject: describeConfigError },
    (subject, [{ segment, issue }]) => {
      const decision = subject(
        DescribeConfigErrorCommand.make({ message: `Expected ${issue}\nat ["${segment}"]` }),
      ).pipe(Result.getOrElse((neverError) => neverError))
      const expected = `Config option "${segment}" should be ${issue}.`
      return S.is(ConfigErrorDescribed)(decision) &&
        decision.errors.at(0) === expected &&
        decision.text.includes(expected)
    },
  )

  it.prop(
    '∀m_Blank_≡BlankMessageIsUnparsed',
    { of: [blankArb], subject: describeConfigError },
    (subject, [message]) => {
      const decision = subject(DescribeConfigErrorCommand.make({ message })).pipe(
        Result.getOrElse((neverError) => neverError),
      )
      return S.is(ConfigErrorUnparsed)(decision)
    },
  )
})
