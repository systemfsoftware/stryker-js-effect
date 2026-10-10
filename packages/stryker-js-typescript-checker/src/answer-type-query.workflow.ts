import { Workflow } from '@systemfsoftware/effect-cell-types'
import { TypeAnswer } from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { assignableAnswer, notAssignableAnswer, unknownAnswer } from './answer-type-query.schema.js'
import {
  AnswerTypeQueryCommand,
  type CallFacts,
  type CandidateTyped,
  type ContextualTypeFacts,
  type SiteExpression,
  type SiteFacts,
} from './CheckerCommands.schema.js'

const typedAnswerOf = (candidate: CandidateTyped, contextualType: ContextualTypeFacts): TypeAnswer =>
  Boolean.match(candidate.assignable, {
    onTrue: () => assignableAnswer(candidate.candidateType),
    onFalse: () => notAssignableAnswer({ candidateType: candidate.candidateType, contextualType: contextualType.text }),
  })

const callAnswerOf = (candidate: CandidateTyped, call: CallFacts, contextualType: ContextualTypeFacts): TypeAnswer =>
  Match.value(call).pipe(
    Match.tag('NotACallArgument', () => typedAnswerOf(candidate, contextualType)),
    Match.tag(
      'CallArgument',
      (argument) =>
        Boolean.match(Boolean.or(argument.signatureCount > 1, argument.resolvedHasTypeParameters), {
          onTrue: () => unknownAnswer('overloaded-or-generic-call'),
          onFalse: () => typedAnswerOf(candidate, contextualType),
        }),
    ),
    Match.exhaustive,
  )

const contextualAnswerOf = (
  candidate: CandidateTyped,
  call: CallFacts,
  contextualType: ContextualTypeFacts,
): TypeAnswer =>
  Boolean.match(contextualType.isError, {
    onTrue: () => unknownAnswer('error-type'),
    onFalse: () =>
      Boolean.match(contextualType.instantiable, {
        onTrue: () => unknownAnswer('instantiable-target'),
        onFalse: () => callAnswerOf(candidate, call, contextualType),
      }),
  })

const siteAnswerOf = (candidate: CandidateTyped, site: SiteFacts): TypeAnswer =>
  Match.value(site).pipe(
    Match.tag('SiteMissing', () => unknownAnswer('site-not-found')),
    Match.tag('SiteNotExpression', () => unknownAnswer('site-not-expression')),
    Match.tag('SiteExpression', (expression: SiteExpression) =>
      Option.match(expression.contextualType, {
        onNone: () => unknownAnswer('no-contextual-type'),
        onSome: (contextualType) => contextualAnswerOf(candidate, expression.call, contextualType),
      })),
    Match.exhaustive,
  )

const answerOf = (command: AnswerTypeQueryCommand): TypeAnswer =>
  Match.value(command.candidate).pipe(
    Match.tag('CandidateNotContextFree', () => unknownAnswer('candidate-not-context-free')),
    Match.tag('CandidateMissing', () => unknownAnswer('candidate-not-found')),
    Match.tag('CandidateTyped', (candidate: CandidateTyped) => siteAnswerOf(candidate, command.site)),
    Match.exhaustive,
  )

const decide = (command: AnswerTypeQueryCommand): Result.Result<TypeAnswer, never> => Result.succeed(answerOf(command))

export const answerTypeQuery = Workflow.make({
  command: AnswerTypeQueryCommand,
  decision: TypeAnswer,
  error: S.Never,
  decide,
})
