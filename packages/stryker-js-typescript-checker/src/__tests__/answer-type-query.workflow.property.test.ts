import {
  Assignable,
  NotAssignable,
  type TypeAnswer,
  Unknown,
  UnknownReason,
} from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import { describe } from '@systemfsoftware/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { answerTypeQuery } from '../answer-type-query.workflow.js'
import {
  AnswerTypeQueryCommand,
  CallArgument,
  type CandidateFacts,
  CandidateMissing,
  CandidateNotContextFree,
  CandidateTyped,
  SiteExpression,
  type SiteFacts,
  SiteMissing,
  SiteNotExpression,
} from '../CheckerCommands.schema.js'
import { AssignableQueryInput } from './answer-type-query.fixture.schema.js'

const UNKNOWN_REASON_ORDER: ReadonlyArray<UnknownReason> = [
  'candidate-not-context-free',
  'candidate-not-found',
  'site-not-found',
  'site-not-expression',
  'no-contextual-type',
  'error-type',
  'instantiable-target',
  'overloaded-or-generic-call',
]

const reasonFails = (site: SiteFacts, candidate: CandidateFacts, reason: UnknownReason): boolean => {
  switch (reason) {
    case 'candidate-not-context-free':
      return S.is(CandidateNotContextFree)(candidate)
    case 'candidate-not-found':
      return S.is(CandidateMissing)(candidate)
    case 'site-not-found':
      return S.is(SiteMissing)(site)
    case 'site-not-expression':
      return S.is(SiteNotExpression)(site)
    case 'no-contextual-type':
      return S.is(SiteExpression)(site) && Option.isNone(site.contextualType)
    case 'error-type':
      return S.is(SiteExpression)(site) && Option.isSome(site.contextualType) && site.contextualType.value.isError
    case 'instantiable-target':
      return S.is(SiteExpression)(site) && Option.isSome(site.contextualType) && site.contextualType.value.instantiable
    case 'overloaded-or-generic-call':
      return (
        S.is(SiteExpression)(site) &&
        S.is(CallArgument)(site.call) &&
        (site.call.signatureCount > 1 || site.call.declaredGeneric)
      )
  }
}

const firstFailingReason = (site: SiteFacts, candidate: CandidateFacts): UnknownReason | undefined =>
  UNKNOWN_REASON_ORDER.find((reason) => reasonFails(site, candidate, reason))

const satisfiedSite = (contextualText: string): SiteFacts => ({
  _tag: 'SiteExpression',
  contextualType: Option.some({ text: contextualText, isError: false, instantiable: false }),
  call: { _tag: 'NotACallArgument' },
})

const typedCandidate = (candidateType: string): CandidateFacts => ({
  _tag: 'CandidateTyped',
  candidateType,
  assignable: true,
})

const commandFailingOnly = (
  reason: UnknownReason,
  candidateType: string,
  contextualText: string,
): AnswerTypeQueryCommand => {
  const candidate = typedCandidate(candidateType)
  switch (reason) {
    case 'candidate-not-context-free':
      return AnswerTypeQueryCommand.make({
        site: satisfiedSite(contextualText),
        candidate: { _tag: 'CandidateNotContextFree' },
      })
    case 'candidate-not-found':
      return AnswerTypeQueryCommand.make({
        site: satisfiedSite(contextualText),
        candidate: { _tag: 'CandidateMissing' },
      })
    case 'site-not-found':
      return AnswerTypeQueryCommand.make({ site: { _tag: 'SiteMissing' }, candidate })
    case 'site-not-expression':
      return AnswerTypeQueryCommand.make({ site: { _tag: 'SiteNotExpression' }, candidate })
    case 'no-contextual-type':
      return AnswerTypeQueryCommand.make({
        site: { _tag: 'SiteExpression', contextualType: Option.none(), call: { _tag: 'NotACallArgument' } },
        candidate,
      })
    case 'error-type':
      return AnswerTypeQueryCommand.make({
        site: {
          _tag: 'SiteExpression',
          contextualType: Option.some({ text: contextualText, isError: true, instantiable: false }),
          call: { _tag: 'NotACallArgument' },
        },
        candidate,
      })
    case 'instantiable-target':
      return AnswerTypeQueryCommand.make({
        site: {
          _tag: 'SiteExpression',
          contextualType: Option.some({ text: contextualText, isError: false, instantiable: true }),
          call: { _tag: 'NotACallArgument' },
        },
        candidate,
      })
    case 'overloaded-or-generic-call':
      return AnswerTypeQueryCommand.make({
        site: {
          _tag: 'SiteExpression',
          contextualType: Option.some({ text: contextualText, isError: false, instantiable: false }),
          call: { _tag: 'CallArgument', signatureCount: 2, declaredGeneric: false },
        },
        candidate,
      })
  }
}

const answerFor = (command: AnswerTypeQueryCommand): Result.Result<TypeAnswer, never> => answerTypeQuery(command)

describe('answerTypeQuery', (it) => {
  it.prop(
    '∀facts_NoFailingReason_≡AssignableByAssignability',
    {
      of: [AssignableQueryInput],
      subject: (input: AssignableQueryInput) =>
        answerTypeQuery(
          AnswerTypeQueryCommand.make({
            site: {
              _tag: 'SiteExpression',
              contextualType: Option.some({
                text: input.contextualTypeText,
                isError: false,
                instantiable: false,
              }),
              call: input.call,
            },
            candidate: { _tag: 'CandidateTyped', candidateType: input.candidateType, assignable: input.assignable },
          }),
        ),
    },
    (subject, [input]) =>
      Result.match(subject(input), {
        onFailure: () => false,
        onSuccess: (answer) =>
          input.assignable
            ? S.is(Assignable)(answer) && answer.candidateType === input.candidateType
            : S.is(NotAssignable)(answer) &&
              answer.candidateType === input.candidateType &&
              answer.contextualType === input.contextualTypeText,
      }),
  )

  it.prop(
    '∀reason_SingleFailure_≡ThatReason',
    {
      of: [UnknownReason, S.String, S.String],
      subject: (reason: UnknownReason, candidateType: string, contextualText: string) =>
        answerTypeQuery(commandFailingOnly(reason, candidateType, contextualText)),
    },
    (subject, [reason, candidateType, contextualText]) =>
      Result.match(subject(reason, candidateType, contextualText), {
        onFailure: () => false,
        onSuccess: (answer) => S.is(Unknown)(answer) && answer.reason === reason,
      }),
  )

  it.prop(
    '∀command_FailingReasons_≡FirstInUnknownReasonOrder',
    { of: [AnswerTypeQueryCommand], subject: answerFor },
    (subject, [command]) => {
      const expected = firstFailingReason(command.site, command.candidate)
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (answer) => {
          if (expected !== undefined) {
            return S.is(Unknown)(answer) && answer.reason === expected
          }
          if (!S.is(CandidateTyped)(command.candidate)) return false
          if (!S.is(SiteExpression)(command.site)) return false
          const candidate = command.candidate
          const contextual = command.site.contextualType
          if (Option.isNone(contextual)) return false
          return candidate.assignable
            ? S.is(Assignable)(answer) && answer.candidateType === candidate.candidateType
            : S.is(NotAssignable)(answer) &&
              answer.candidateType === candidate.candidateType &&
              answer.contextualType === contextual.value.text
        },
      })
    },
  )
})
