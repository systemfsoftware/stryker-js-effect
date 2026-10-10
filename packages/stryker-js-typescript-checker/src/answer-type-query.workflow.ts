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
  type SiteFunctionBody,
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

const reasonIf = (condition: boolean, reason: UnknownReason): Option.Option<UnknownReason> =>
  Boolean.match(condition, { onTrue: () => Option.some(reason), onFalse: () => Option.none() })

const targetReasonOf = (target: ContextualTypeFacts): Option.Option<UnknownReason> =>
  Option.firstSomeOf([
    reasonIf(target.isError, 'error-type'),
    reasonIf(target.instantiable, 'instantiable-target'),
  ])

const functionBodyUnknownOf = (site: SiteFunctionBody): Option.Option<UnknownReason> =>
  Option.firstSomeOf([
    reasonIf(Option.isNone(site.target), 'no-contextual-type'),
    reasonIf(site.generator, 'generator-body'),
    reasonIf(site.functionKind === 'constructor', 'constructor-body'),
    reasonIf(
      Boolean.and(Boolean.not(site.returnTypeDeclared), site.functionKind !== 'setter'),
      'return-type-not-declared',
    ),
    reasonIf(Boolean.and(site.async, Boolean.not(site.asyncReturnIsPromise)), 'async-return-not-promise'),
    Option.flatMap(site.target, targetReasonOf),
  ])

const targetTextOf = (site: SiteFunctionBody): string =>
  Option.getOrElse(Option.map(site.target, (target) => target.text), () => '')

const functionBodyTypedOf = (site: SiteFunctionBody): AnswerDecision =>
  Boolean.match(site.undefinedAssignable, {
    onFalse: () => notAssignableAnswer('undefined', targetTextOf(site)),
    onTrue: () =>
      Boolean.match(site.functionKind === 'getter', {
        onTrue: () => unknownAnswer('getter-requires-return'),
        onFalse: () =>
          Boolean.match(site.targetAllowsImplicitReturn, {
            onTrue: () => assignableAnswer('undefined'),
            onFalse: () => unknownAnswer('implicit-return-rejected'),
          }),
      }),
  })

const functionBodyAnswerOf = (site: SiteFunctionBody, text: string): AnswerDecision =>
  Boolean.match(text === '{}', {
    onFalse: () => unknownAnswer('candidate-not-empty-body'),
    onTrue: () =>
      Option.match(functionBodyUnknownOf(site), {
        onNone: () => functionBodyTypedOf(site),
        onSome: unknownAnswer,
      }),
  })

const bodySiteAnswerOf = (text: string, site: SiteFacts): AnswerDecision =>
  Match.value(site).pipe(
    Match.tag('SiteMissing', () => unknownAnswer('site-not-found')),
    Match.tag('SiteNotExpression', () => unknownAnswer('site-not-expression')),
    Match.tag('SiteNotFunctionBody', () => unknownAnswer('site-not-function-body')),
    Match.tag('SiteFunctionBody', (body) => functionBodyAnswerOf(body, text)),
    Match.tag('SiteExpression', () => unknownAnswer('site-not-function-body')),
    Match.exhaustive,
  )

const siteAnswerOf = (candidate: CandidateTyped, site: SiteFacts): AnswerDecision =>
  Match.value(site).pipe(
    Match.tag('SiteMissing', () => unknownAnswer('site-not-found')),
    Match.tag('SiteNotExpression', () => unknownAnswer('site-not-expression')),
    Match.tag('SiteNotFunctionBody', () => unknownAnswer('site-not-function-body')),
    Match.tag('SiteFunctionBody', () => unknownAnswer('candidate-not-empty-body')),
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
    Match.tag('CandidateBodyText', (body) => bodySiteAnswerOf(body.text, command.site)),
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
