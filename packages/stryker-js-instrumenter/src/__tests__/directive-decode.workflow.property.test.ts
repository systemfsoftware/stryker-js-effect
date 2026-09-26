import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  decodeDirective,
  DecodeDirectiveCommand,
  DirectiveDecoded,
  DirectiveMalformed,
} from '../directives/decode-directive.workflow.js'
import { type Directive, DirectiveSchema } from '../directives/directive.schema.js'

const commandOf = (text: string): DecodeDirectiveCommand => DecodeDirectiveCommand.make({ commentText: text })

const scopeText = (scope: Directive['scope']): string => scope === 'next-line' ? ' next-line' : ''

const commentOf = (directive: Directive): string =>
  ` Stryker ${directive.action}${scopeText(directive.scope)} ${directive.mutatorNames.join(',')}:${directive.reason}`

describe('decodeDirective', () => {
  it.prop(
    '∀d_Directive_≡DecodedAsWritten',
    { of: [DirectiveSchema], subject: decodeDirective },
    (subject, [directive]) => {
      const decided = subject(commandOf(commentOf(directive)))
      if (!Result.isSuccess(decided) || !S.is(DirectiveDecoded)(decided.success)) {
        return false
      }
      const decoded = decided.success.directive
      return decoded.action === directive.action &&
        decoded.scope === directive.scope &&
        decoded.mutatorNames.join(',') === directive.mutatorNames.join(',') &&
        decoded.reason === directive.reason
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
