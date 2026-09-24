import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  decodeDirective,
  DecodeDirectiveCommand,
  type DirectiveDecision,
  DirectiveDecoded,
  DirectiveMalformed,
  StrykerCommentSchema,
} from '../directives/decode-directive.workflow.js'

const DirectiveDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/DirectiveDecision',
)

const commentText = (comment: typeof StrykerCommentSchema.Type): string =>
  `${comment.clause} ${comment.nameLetters.join('')}`

const isDirectiveClause = (clause: string): boolean => clause.includes('disable') || clause.includes('restore')

const expectedAction = (clause: string): 'disable' | 'restore' => clause.includes('restore') ? 'restore' : 'disable'

const expectedScope = (clause: string): 'next-line' | 'block' => clause.includes('next-line') ? 'next-line' : 'block'

const expectedNames = (comment: typeof StrykerCommentSchema.Type): readonly string[] =>
  comment.nameLetters
    .join('')
    .split(',')
    .map((name) => name.trim().replace(/\s+/g, ' '))
    .filter((name) => name.length > 0)

const decide = (text: string): Result.Result<DirectiveDecision, never> =>
  decodeDirective(DecodeDirectiveCommand.make({ commentText: text }))

const hasBrand = (decision: DirectiveDecision): boolean =>
  Object.getOwnPropertySymbols(decision).includes(DirectiveDecisionTypeId)

describe('decodeDirective', () => {
  it.prop(
    '∀d_Brand_∈Decision',
    [DirectiveDecoded, DirectiveMalformed],
    ([decoded, malformed]) => hasBrand(decoded) && hasBrand(malformed),
  )

  it.prop('∀c_StrykerComment_≡DecodedAsWrittenOrMalformed', [StrykerCommentSchema], ([comment]) => {
    const decided = decide(commentText(comment))
    if (!Result.isSuccess(decided)) {
      return false
    }
    const decision = decided.success
    const names = expectedNames(comment)
    if (!isDirectiveClause(comment.clause) || names.length === 0) {
      return S.is(DirectiveMalformed)(decision)
    }
    return S.is(DirectiveDecoded)(decision) &&
      decision.directive.action === expectedAction(comment.clause) &&
      decision.directive.scope === expectedScope(comment.clause) &&
      decision.directive.mutatorNames.join(',') === names.join(',')
  })

  it.prop('∀t_Text_≡MalformedWithoutTheDirectiveVerb', [S.String], ([text]) => {
    const decided = decide(text.replaceAll('Stryker', 'Other'))
    return Result.isSuccess(decided) && S.is(DirectiveMalformed)(decided.success)
  })
})
