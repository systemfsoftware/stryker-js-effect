import { describe } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import { AssignableQueryInput } from '../../tests/__fixtures__/answer-type-query-law.fixture.js'
import {
  AnswerAssignable,
  type AnswerDecision,
  AnswerNotAssignable,
  answerTypeQuery,
  AnswerUnknown,
} from '../answer-type-query.workflow.js'
import {
  AnswerTypeQueryCommand,
  CallArgument,
  CandidateBodyText,
  type CandidateFacts,
  CandidateMissing,
  CandidateNotContextFree,
  CandidateTyped,
  type ContextualTypeFacts,
  type FunctionBodyKind,
  SiteExpression,
  type SiteFacts,
  SiteFunctionBody,
  SiteMissing,
  SiteNotExpression,
  SiteNotFunctionBody,
  UnenforcedContext,
} from '../CheckerCommands.schema.js'

const TARGET_PLAIN: ContextualTypeFacts = { text: 'number', isError: false, instantiable: false }

interface BodyOverrides {
  readonly functionKind?: FunctionBodyKind
  readonly generator?: boolean
  readonly async?: boolean
  readonly returnTypeDeclared?: boolean
  readonly asyncReturnIsPromise?: boolean
  readonly target?: Option.Option<ContextualTypeFacts>
  readonly undefinedAssignable?: boolean
  readonly targetAllowsImplicitReturn?: boolean
}

const satisfiedFunctionBody = (overrides: BodyOverrides = {}): SiteFunctionBody => ({
  _tag: 'SiteFunctionBody',
  functionKind: overrides.functionKind ?? 'other',
  generator: overrides.generator ?? false,
  async: overrides.async ?? false,
  returnTypeDeclared: overrides.returnTypeDeclared ?? true,
  asyncReturnIsPromise: overrides.asyncReturnIsPromise ?? false,
  target: overrides.target ?? Option.some(TARGET_PLAIN),
  undefinedAssignable: overrides.undefinedAssignable ?? true,
  targetAllowsImplicitReturn: overrides.targetAllowsImplicitReturn ?? true,
})

const bodyCommand = (body: SiteFunctionBody, text: string): AnswerTypeQueryCommand =>
  AnswerTypeQueryCommand.make({ site: body, candidate: { _tag: 'CandidateBodyText', text } })

const answerFor = (command: AnswerTypeQueryCommand): Result.Result<AnswerDecision, never> => answerTypeQuery(command)

const decisionOf = (command: AnswerTypeQueryCommand): AnswerDecision =>
  Result.match(answerFor(command), {
    onFailure: () => AnswerUnknown.make({ reason: 'site-not-found' }),
    onSuccess: (answer) => answer,
  })

const UNKNOWN_REASON_ORDER: ReadonlyArray<TypeQuery.UnknownReason> = [
  'candidate-not-context-free',
  'candidate-not-found',
  'site-not-found',
  'site-not-expression',
  'site-not-function-body',
  'candidate-not-empty-body',
  'no-contextual-type',
  'generator-body',
  'constructor-body',
  'return-type-not-declared',
  'async-return-not-promise',
  'error-type',
  'instantiable-target',
  'overloaded-or-generic-call',
  'context-not-enforced',
  'getter-requires-return',
  'implicit-return-rejected',
]

const errorsOn = (site: SiteFacts): boolean =>
  S.is(SiteExpression)(site) && Option.isSome(site.contextualType) && site.contextualType.value.isError
const instantiatesOn = (site: SiteFacts): boolean =>
  S.is(SiteExpression)(site) && Option.isSome(site.contextualType) && site.contextualType.value.instantiable
const bodyErrorsOn = (site: SiteFacts): boolean =>
  S.is(SiteFunctionBody)(site) && Option.isSome(site.target) && site.target.value.isError
const bodyInstantiatesOn = (site: SiteFacts): boolean =>
  S.is(SiteFunctionBody)(site) && Option.isSome(site.target) && site.target.value.instantiable

const reasonFails = (site: SiteFacts, candidate: CandidateFacts, reason: TypeQuery.UnknownReason): boolean => {
  switch (reason) {
    case 'candidate-not-context-free':
      return S.is(CandidateNotContextFree)(candidate)
    case 'candidate-not-found':
      return S.is(CandidateMissing)(candidate)
    case 'site-not-found':
      return S.is(SiteMissing)(site)
    case 'site-not-expression':
      return S.is(SiteNotExpression)(site)
    case 'site-not-function-body':
      return S.is(SiteNotFunctionBody)(site) || (S.is(SiteExpression)(site) && S.is(CandidateBodyText)(candidate))
    case 'candidate-not-empty-body':
      return (S.is(CandidateBodyText)(candidate) && candidate.text !== '{}') ||
        (S.is(SiteFunctionBody)(site) && S.is(CandidateTyped)(candidate))
    case 'no-contextual-type':
      return (S.is(SiteExpression)(site) && Option.isNone(site.contextualType)) ||
        (S.is(SiteFunctionBody)(site) && Option.isNone(site.target))
    case 'generator-body':
      return S.is(SiteFunctionBody)(site) && site.generator
    case 'constructor-body':
      return S.is(SiteFunctionBody)(site) && site.functionKind === 'constructor'
    case 'return-type-not-declared':
      return S.is(SiteFunctionBody)(site) && !site.returnTypeDeclared && site.functionKind !== 'setter'
    case 'async-return-not-promise':
      return S.is(SiteFunctionBody)(site) && site.async && !site.asyncReturnIsPromise
    case 'error-type':
      return errorsOn(site) || bodyErrorsOn(site)
    case 'instantiable-target':
      return instantiatesOn(site) || bodyInstantiatesOn(site)
    case 'overloaded-or-generic-call':
      return (
        S.is(SiteExpression)(site) &&
        S.is(CallArgument)(site.origin) &&
        (site.origin.signatureCount > 1 || site.origin.declaredGeneric)
      )
    case 'context-not-enforced':
      return S.is(SiteExpression)(site) && S.is(UnenforcedContext)(site.origin)
    case 'getter-requires-return':
      return S.is(SiteFunctionBody)(site) && site.functionKind === 'getter' && site.undefinedAssignable
    case 'implicit-return-rejected':
      return (
        S.is(SiteFunctionBody)(site) &&
        site.undefinedAssignable &&
        site.functionKind !== 'getter' &&
        !site.targetAllowsImplicitReturn &&
        Option.isSome(site.target) &&
        !site.target.value.isError &&
        !site.target.value.instantiable
      )
  }
}

const firstFailingReason = (site: SiteFacts, candidate: CandidateFacts): TypeQuery.UnknownReason | undefined =>
  UNKNOWN_REASON_ORDER.find((reason) => reasonFails(site, candidate, reason))

const typedAnswerMatches = (command: AnswerTypeQueryCommand, answer: AnswerDecision): boolean => {
  const candidate = command.candidate
  const site = command.site
  if (S.is(CandidateTyped)(candidate) && S.is(SiteExpression)(site)) {
    return Option.match(site.contextualType, {
      onNone: () => false,
      onSome: (facts) =>
        candidate.assignable
          ? S.is(AnswerAssignable)(answer) && answer.candidateType === candidate.candidateType
          : S.is(AnswerNotAssignable)(answer) && answer.candidateType === candidate.candidateType &&
            answer.contextualType === facts.text,
    })
  }
  if (S.is(CandidateBodyText)(candidate) && S.is(SiteFunctionBody)(site)) {
    return Option.match(site.target, {
      onNone: () => false,
      onSome: (target) =>
        site.undefinedAssignable
          ? S.is(AnswerAssignable)(answer) && answer.candidateType === 'undefined'
          : S.is(AnswerNotAssignable)(answer) && answer.candidateType === 'undefined' &&
            answer.contextualType === target.text,
    })
  }
  return false
}

const typedCandidate = (candidateType: string): CandidateFacts => ({
  _tag: 'CandidateTyped',
  candidateType,
  assignable: true,
})

const satisfiedSite = (contextualText: string): SiteFacts => ({
  _tag: 'SiteExpression',
  contextualType: Option.some({ text: contextualText, isError: false, instantiable: false }),
  origin: { _tag: 'DeclaredContext' },
})

const commandFailingOnly = (
  reason: TypeQuery.UnknownReason,
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
    case 'site-not-function-body':
      return AnswerTypeQueryCommand.make({ site: { _tag: 'SiteNotFunctionBody' }, candidate })
    case 'candidate-not-empty-body':
      return bodyCommand(satisfiedFunctionBody(), '0')
    case 'no-contextual-type':
      return AnswerTypeQueryCommand.make({
        site: { _tag: 'SiteExpression', contextualType: Option.none(), origin: { _tag: 'DeclaredContext' } },
        candidate,
      })
    case 'generator-body':
      return bodyCommand(satisfiedFunctionBody({ generator: true }), '{}')
    case 'constructor-body':
      return bodyCommand(satisfiedFunctionBody({ functionKind: 'constructor' }), '{}')
    case 'return-type-not-declared':
      return bodyCommand(satisfiedFunctionBody({ returnTypeDeclared: false }), '{}')
    case 'async-return-not-promise':
      return bodyCommand(satisfiedFunctionBody({ async: true, asyncReturnIsPromise: false }), '{}')
    case 'error-type':
      return AnswerTypeQueryCommand.make({
        site: {
          _tag: 'SiteExpression',
          contextualType: Option.some({ text: contextualText, isError: true, instantiable: false }),
          origin: { _tag: 'DeclaredContext' },
        },
        candidate,
      })
    case 'instantiable-target':
      return AnswerTypeQueryCommand.make({
        site: {
          _tag: 'SiteExpression',
          contextualType: Option.some({ text: contextualText, isError: false, instantiable: true }),
          origin: { _tag: 'DeclaredContext' },
        },
        candidate,
      })
    case 'overloaded-or-generic-call':
      return AnswerTypeQueryCommand.make({
        site: {
          _tag: 'SiteExpression',
          contextualType: Option.some({ text: contextualText, isError: false, instantiable: false }),
          origin: { _tag: 'CallArgument', signatureCount: 2, declaredGeneric: false },
        },
        candidate,
      })
    case 'context-not-enforced':
      return AnswerTypeQueryCommand.make({
        site: {
          _tag: 'SiteExpression',
          contextualType: Option.some({ text: contextualText, isError: false, instantiable: false }),
          origin: { _tag: 'UnenforcedContext' },
        },
        candidate,
      })
    case 'getter-requires-return':
      return bodyCommand(satisfiedFunctionBody({ functionKind: 'getter' }), '{}')
    case 'implicit-return-rejected':
      return bodyCommand(satisfiedFunctionBody({ targetAllowsImplicitReturn: false }), '{}')
  }
}

const functionBodyReasonOf = (body: SiteFunctionBody): TypeQuery.UnknownReason | undefined => {
  if (Option.isNone(body.target)) return 'no-contextual-type'
  if (body.generator) return 'generator-body'
  if (body.functionKind === 'constructor') return 'constructor-body'
  if (!body.returnTypeDeclared && body.functionKind !== 'setter') return 'return-type-not-declared'
  if (body.async && !body.asyncReturnIsPromise) return 'async-return-not-promise'
  if (body.target.value.isError) return 'error-type'
  if (body.target.value.instantiable) return 'instantiable-target'
  if (!body.undefinedAssignable) return undefined
  if (body.functionKind === 'getter') return 'getter-requires-return'
  if (!body.targetAllowsImplicitReturn) return 'implicit-return-rejected'
  return undefined
}

const decisionTagOf = (answer: AnswerDecision): string =>
  Match.valueTags(answer, {
    AnswerAssignable: () => 'Assignable',
    AnswerNotAssignable: () => 'NotAssignable',
    AnswerUnknown: (unknown) => `Unknown ${unknown.reason}`,
  })

const bodyModelOf = (body: SiteFunctionBody, text: string): string => {
  if (text !== '{}') return 'Unknown candidate-not-empty-body'
  const reason = functionBodyReasonOf(body)
  if (reason !== undefined) return `Unknown ${reason}`
  return body.undefinedAssignable ? 'Assignable' : 'NotAssignable'
}

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
              origin: input.origin,
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
            ? S.is(AnswerAssignable)(answer) && answer.candidateType === input.candidateType
            : S.is(AnswerNotAssignable)(answer) &&
              answer.candidateType === input.candidateType &&
              answer.contextualType === input.contextualTypeText,
      }),
  )

  it.prop(
    '∀reason_SingleFailure_≡ThatReason',
    {
      of: [TypeQuery.UnknownReason, S.String, S.String],
      subject: (reason: TypeQuery.UnknownReason, candidateType: string, contextualText: string) =>
        answerTypeQuery(commandFailingOnly(reason, candidateType, contextualText)),
    },
    (subject, [reason, candidateType, contextualText]) =>
      Result.match(subject(reason, candidateType, contextualText), {
        onFailure: () => false,
        onSuccess: (answer) => S.is(AnswerUnknown)(answer) && answer.reason === reason,
      }),
  )

  it.prop(
    '∀command_FailingReasons_≡FirstInUnknownReasonOrder',
    { of: [AnswerTypeQueryCommand], subject: answerFor },
    (subject, [command]) => {
      const expected = firstFailingReason(command.site, command.candidate)
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (answer) =>
          expected !== undefined
            ? S.is(AnswerUnknown)(answer) && answer.reason === expected
            : typedAnswerMatches(command, answer),
      })
    },
  )

  it.prop(
    '∀body,text_Answer_≡IndependentContractModel',
    {
      of: [SiteFunctionBody, S.Literals(['{}', '0'])],
      subject: (body: SiteFunctionBody, text: string) => decisionTagOf(decisionOf(bodyCommand(body, text))),
    },
    (subject, [body, text]) => subject(body, text) === bodyModelOf(body, text),
  )
})
