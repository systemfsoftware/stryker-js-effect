import { describe } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { AliasSpecifierCaptured, captureAliasSpecifier } from '../capture-alias-specifier.workflow.js'
import { CaptureAliasSpecifierCommand } from '../CheckerCommands.schema.js'

const captureFor = (command: CaptureAliasSpecifierCommand): string | undefined => {
  const decision = Result.match(captureAliasSpecifier(command), {
    onFailure: (refused) => refused,
    onSuccess: (value) => value,
  })
  return S.is(AliasSpecifierCaptured)(decision) ? decision.capture : undefined
}

const prefixOf = (pattern: string): string => pattern.slice(0, pattern.indexOf('*'))

const suffixOf = (pattern: string): string => pattern.slice(pattern.indexOf('*') + 1)

describe('captureAliasSpecifier', (it) => {
  it.prop(
    '∀command_ExactPattern_≡EmptyOrNone',
    { of: [CaptureAliasSpecifierCommand], subject: captureFor },
    (subject, [command]) =>
      command.pattern.includes('*') ||
      Equal.equals(subject(command), command.specifier === command.pattern ? '' : undefined),
  )

  it.prop(
    '∀command_WildcardCapture_≡SpecifierReconstruction',
    { of: [CaptureAliasSpecifierCommand], subject: captureFor },
    (subject, [command]) => {
      const capture = subject(command)
      return (
        !command.pattern.includes('*') ||
        capture === undefined ||
        command.specifier === prefixOf(command.pattern) + capture + suffixOf(command.pattern)
      )
    },
  )
})
