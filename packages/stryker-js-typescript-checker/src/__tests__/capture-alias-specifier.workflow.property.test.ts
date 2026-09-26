import { describe } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { AliasSpecifierCaptured, captureAliasSpecifier } from '../capture-alias-specifier.workflow.js'
import { CaptureAliasSpecifierCommand } from '../CheckerCommands.schema.js'

const exactAliasPattern = () => S.String.check(S.isPattern(/^[^*]*$/))

const hashFreePattern = () => S.String.check(S.isPattern(/^[^#*]+$/))

const captureFor = (pattern: string, specifier: string): string | undefined => {
  const decision = Result.match(captureAliasSpecifier(CaptureAliasSpecifierCommand.make({ pattern, specifier })), {
    onFailure: (refused) => refused,
    onSuccess: (value) => value,
  })
  return S.is(AliasSpecifierCaptured)(decision) ? decision.capture : undefined
}

const wildcardCaptureFor = (prefix: string, suffix: string, middle: string): string | undefined =>
  captureFor(prefix + '*' + suffix, prefix + middle + suffix)

const prefixNotSufficientFor = (
  prefix: string,
  suffix: string,
  middle: string,
): readonly [string | undefined, string | undefined] => [
  captureFor(`${prefix}*${suffix}`, `${prefix}${middle}${suffix}`),
  captureFor(`${prefix}*${suffix}`, `${prefix}${middle}${suffix}#`),
]

describe('captureAliasSpecifier', (it) => {
  it.prop(
    '∀alias_ExactSpecifier_≡EmptyOrNone',
    { of: [exactAliasPattern(), S.String], subject: captureFor },
    (subject, [pattern, specifier]) => subject(pattern, specifier) === (specifier === pattern ? '' : undefined),
  )

  it.prop(
    '∀alias_WildcardSpecifier_≡MiddleSegment',
    { of: [exactAliasPattern(), S.String.check(S.isMinLength(1)), S.String], subject: wildcardCaptureFor },
    (subject, [prefix, suffix, middle]) => subject(prefix, suffix, middle) === middle,
  )

  it.prop(
    '∀alias_WildcardPrefixes_≡MiddleSegmentAndNoneElsewhere',
    { of: [exactAliasPattern(), hashFreePattern(), S.String], subject: prefixNotSufficientFor },
    (subject, [prefix, suffix, middle]) => {
      const [matching, unrelated] = subject(prefix, suffix, middle)
      return matching === middle && unrelated === undefined
    },
  )
})
