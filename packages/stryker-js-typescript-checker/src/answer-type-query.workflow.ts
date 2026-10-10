import { Workflow } from '@systemfsoftware/effect-cell-types'
import { UnknownReason } from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  AnswerTypeQueryCommand,
  type CandidateTyped,
  type ContextOrigin,
  type ContextualTypeFacts,
  type SiteExpression,
  type SiteFacts,
} from './CheckerCommands.schema.js'

const AnswerTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/AnswerDecision')
type AnswerTypeId = typeof AnswerTypeId

export class AnswerAssignable extends S.TaggedClass<AnswerAssignable>()('AnswerAssignable', {
  candidateType: S.String,
}) {
  readonly [AnswerTypeId] = AnswerTypeId
}

export class AnswerNotAssignable extends S.TaggedClass<AnswerNotAssignable>()('AnswerNotAssignable', {
  candidateType: S.String,
  contextualType: S.String,
}) {
  readonly [AnswerTypeId] = AnswerTypeId
}

export class AnswerUnknown extends S.TaggedClass<AnswerUnknown>()('AnswerUnknown', { reason: UnknownReason }) {
  readonly [AnswerTypeId] = AnswerTypeId
}

export const AnswerDecision = S.Union([AnswerAssignable, AnswerNotAssignable, AnswerUnknown])
export type AnswerDecision = AnswerAssignable | AnswerNotAssignable | AnswerUnknown

const unknownAnswer = (reason: UnknownReason): AnswerDecision => AnswerUnknown.make({ reason })

const assignableAnswer = (candidateType: string): AnswerDecision => AnswerAssignable.make({ candidateType })

const notAssignableAnswer = (candidateType: string, contextualType: string): AnswerDecision =>
  AnswerNotAssignable.make({ candidateType, contextualType })

const typedAnswerOf = (candidate: CandidateTyped, contextualType: ContextualTypeFacts): AnswerDecision =>
  Boolean.match(candidate.assignable, {
    onTrue: () => assignableAnswer(candidate.candidateType),
    onFalse: () => notAssignableAnswer(candidate.candidateType, contextualType.text),
  })

const originAnswerOf = (
  candidate: CandidateTyped,
  origin: ContextOrigin,
  contextualType: ContextualTypeFacts,
): AnswerDecision =>
  Match.value(origin).pipe(
    Match.tag('DeclaredContext', () => typedAnswerOf(candidate, contextualType)),
    Match.tag(
      'CallArgument',
      (argument) =>
        Boolean.match(Boolean.or(argument.signatureCount > 1, argument.declaredGeneric), {
          onTrue: () => unknownAnswer('overloaded-or-generic-call'),
          onFalse: () => typedAnswerOf(candidate, contextualType),
        }),
    ),
    Match.tag('UnenforcedContext', () => unknownAnswer('context-not-enforced')),
    Match.exhaustive,
  )

const contextualAnswerOf = (
  candidate: CandidateTyped,
  origin: ContextOrigin,
  contextualType: ContextualTypeFacts,
): AnswerDecision =>
  Boolean.match(contextualType.isError, {
    onTrue: () => unknownAnswer('error-type'),
    onFalse: () =>
      Boolean.match(contextualType.instantiable, {
        onTrue: () => unknownAnswer('instantiable-target'),
        onFalse: () => originAnswerOf(candidate, origin, contextualType),
      }),
  })

const siteAnswerOf = (candidate: CandidateTyped, site: SiteFacts): AnswerDecision =>
  Match.value(site).pipe(
    Match.tag('SiteMissing', () => unknownAnswer('site-not-found')),
    Match.tag('SiteNotExpression', () => unknownAnswer('site-not-expression')),
    Match.tag('SiteExpression', (expression: SiteExpression) =>
      Option.match(expression.contextualType, {
        onNone: () => unknownAnswer('no-contextual-type'),
        onSome: (contextualType) => contextualAnswerOf(candidate, expression.origin, contextualType),
      })),
    Match.exhaustive,
  )

const answerOf = (command: AnswerTypeQueryCommand): AnswerDecision =>
  Match.value(command.candidate).pipe(
    Match.tag('CandidateNotContextFree', () => unknownAnswer('candidate-not-context-free')),
    Match.tag('CandidateMissing', () => unknownAnswer('candidate-not-found')),
    Match.tag('CandidateTyped', (candidate: CandidateTyped) => siteAnswerOf(candidate, command.site)),
    Match.exhaustive,
  )

const decide = (command: AnswerTypeQueryCommand): Result.Result<AnswerDecision, never> =>
  Result.succeed(answerOf(command))

export const answerTypeQuery = Workflow.make({
  command: AnswerTypeQueryCommand,
  decision: AnswerDecision,
  error: S.Never,
  decide,
})
