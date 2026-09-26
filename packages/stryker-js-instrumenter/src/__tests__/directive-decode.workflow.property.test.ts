import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  decodeDirective,
  DecodeDirectiveCommand,
  DirectiveDecoded,
  DirectiveMalformed,
} from '../directives/decode-directive.workflow.js'

const mutatorNameSchema = () => S.String.pipe(S.check(S.isPattern(/^[a-zA-Z]+(?: [a-zA-Z]+)*$/)))

const directiveReasonSchema = () => S.String.pipe(S.check(S.isPattern(/^\S(?:[^\r\n\u2028\u2029]*\S)?$/)))

const commentFormSchema = () =>
  S.Struct({
    action: S.Literals(['disable', 'restore']),
    scope: S.Literals(['block', 'next-line']),
    mutatorNames: S.Array(mutatorNameSchema()).check(S.isMinLength(1)),
    reason: S.optional(directiveReasonSchema()),
  })

const commandOf = (text: string): DecodeDirectiveCommand => DecodeDirectiveCommand.make({ commentText: text })

describe('decodeDirective', () => {
  it.prop(
    '∀f_CommentForm_≡DecodedAsWritten',
    { of: [commentFormSchema()], subject: decodeDirective },
    (subject, [form]) => {
      const scope = form.scope === 'next-line' ? ' next-line' : ''
      const reason = form.reason === undefined ? '' : `:${form.reason}`
      const decided = subject(commandOf(` Stryker ${form.action}${scope} ${form.mutatorNames.join(',')}${reason}`))
      if (!Result.isSuccess(decided) || !S.is(DirectiveDecoded)(decided.success)) {
        return false
      }
      const directive = decided.success.directive
      return directive.action === form.action &&
        directive.scope === form.scope &&
        directive.mutatorNames.join(',') === form.mutatorNames.join(',') &&
        (form.reason === undefined || directive.reason === form.reason)
    },
  )

  it.prop(
    '∀t_Text_≡MalformedWithoutTheDirectiveVerb',
    { of: [S.String], subject: decodeDirective },
    (subject, [text]) => {
      const decided = subject(commandOf(text.replaceAll('Stryker', 'Other')))
      return Result.isSuccess(decided) && S.is(DirectiveMalformed)(decided.success)
    },
  )
})
