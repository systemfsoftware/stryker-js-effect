import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { compileGlob, CompileGlobCommand, type CompileGlobDecision, GlobUnmatchable } from '../compile-glob.workflow.js'

const segmentArb = Arbitrary.schema(S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,5}$/)))

const pathArb = Arbitrary.array(segmentArb, { minLength: 1, maxLength: 4 }).pipe(
  Arbitrary.map((segments) => `/${segments.join('/')}`),
)

const escapedLiteralArb = Arbitrary.schema(
  S.String.check(S.isPattern(/^[a-z0-9\\^$.|()+]{1,4}$/)),
)

const caseArb = Arbitrary.schema(S.Boolean)

const command = (pattern: boolean | string, caseInsensitive: boolean) =>
  CompileGlobCommand.make({ pattern, caseInsensitive })

const decisionOf = (result: Result.Result<CompileGlobDecision, never>): CompileGlobDecision =>
  Result.getOrElse(result, (neverError) => neverError)

const accepted = (result: Result.Result<CompileGlobDecision, never>, candidate: string): boolean => {
  const decision = decisionOf(result)
  return Match.value(decision).pipe(
    Match.withReturnType<boolean>(),
    Match.tag('GlobMatcher', (matcher) => new RegExp(matcher.source, matcher.flags).test(candidate)),
    Match.tag('GlobUnmatchable', () => false),
    Match.exhaustive,
  )
}

const flagsOf = (result: Result.Result<CompileGlobDecision, never>): string => {
  const decision = decisionOf(result)
  return Match.value(decision).pipe(
    Match.withReturnType<string>(),
    Match.tag('GlobMatcher', (matcher) => matcher.flags),
    Match.tag('GlobUnmatchable', () => ''),
    Match.exhaustive,
  )
}

describe('compileGlob', () => {
  it.prop(
    '∀p_Literal_≡MatchesItself',
    { of: [pathArb], subject: compileGlob },
    (subject, [path]) => accepted(subject(command(path, false)), path),
  )

  it.prop(
    '∀p_Literal_≡RejectsAnyOtherLength',
    { of: [pathArb], subject: compileGlob },
    (subject, [path]) =>
      !accepted(subject(command(path, false)), `${path}x`) && !accepted(subject(command(path, false)), `x${path}`),
  )

  it.prop(
    '∀s_LiteralMetacharacter_≡EscapedToItselfOnly',
    { of: [escapedLiteralArb], subject: compileGlob },
    (subject, [literal]) => {
      const pattern = `x${literal}y`
      const decoy = `x${literal[0] === 'z' ? 'q' : 'z'}${literal.slice(1)}y`
      return (
        accepted(subject(command(pattern, false)), pattern) &&
        !accepted(subject(command(pattern, false)), decoy)
      )
    },
  )

  it.prop(
    '∀s_Star_≡OneSegmentOnly',
    { of: [segmentArb], subject: compileGlob },
    (subject, [segment]) =>
      accepted(subject(command(`/x/*.${segment}`, false)), `/x/a.${segment}`) &&
      !accepted(subject(command(`/x/*.${segment}`, false)), `/x/y/a.${segment}`),
  )

  it.prop(
    '∀s_StarStar_≡AnyDepth',
    { of: [segmentArb], subject: compileGlob },
    (subject, [segment]) =>
      accepted(subject(command(`/x/**/${segment}.ts`, false)), `/x/y/z/${segment}.ts`) &&
      accepted(subject(command(`/x/**/${segment}.ts`, false)), `/x/${segment}.ts`),
  )

  it.prop(
    '∀q_Question_≡OneNonSlashCharacter',
    { of: [segmentArb], subject: compileGlob },
    (subject, [segment]) =>
      accepted(subject(command(`a?${segment}`, false)), `ab${segment}`) &&
      !accepted(subject(command(`a?${segment}`, false)), `a/${segment}`) &&
      !accepted(subject(command(`a?${segment}`, false)), `a${segment}`),
  )

  it.prop(
    '∀e_Extension_≡BraceAlternation',
    { of: [segmentArb], subject: compileGlob },
    (subject, [segment]) =>
      accepted(subject(command('*.{js,ts}', false)), `${segment}.js`) &&
      accepted(subject(command('*.{js,ts}', false)), `${segment}.ts`) &&
      !accepted(subject(command('*.{js,ts}', false)), `${segment}.md`),
  )

  it.prop(
    '∀c_Case_≡FlagFollowsRequest',
    { of: [caseArb], subject: compileGlob },
    (subject, [caseInsensitive]) =>
      flagsOf(subject(command('ABC', caseInsensitive))) === (caseInsensitive ? 'i' : '') &&
      accepted(subject(command('ABC', caseInsensitive)), 'abc') === caseInsensitive,
  )

  it.prop(
    '∀b_NonStringPattern_≡NoMatcherAdmitted',
    { of: [caseArb], subject: compileGlob },
    (subject, [flag]) => {
      const decision = decisionOf(subject(command(flag, false)))
      return S.is(GlobUnmatchable)(decision) && decision.pattern === flag
    },
  )
})
