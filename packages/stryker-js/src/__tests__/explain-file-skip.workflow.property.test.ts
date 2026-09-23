import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  explainFileSkip,
  ExplainFileSkipCommand,
  FileSkipDecision,
  SkipKnownExplained,
} from '../run/explain-file-skip.workflow.js'

const ExplainFileSkipTypeId = Symbol.for('@systemfsoftware/stryker-js/ExplainFileSkipDecision')

const ANGULAR_MODULE = '@systemfsoftware/stryker-js-angular'
const SVELTE_MODULE = '@systemfsoftware/stryker-js-svelte'

const expectedOwnerOf = (extension: string): string | null =>
  extension === '.html' || extension === '.htm' || extension === '.vue'
    ? ANGULAR_MODULE
    : extension === '.svelte'
    ? SVELTE_MODULE
    : null

describe('explainFileSkip', () => {
  it.prop('∀c_Command_∈Decision', [ExplainFileSkipCommand], ([command]) => {
    const result = explainFileSkip(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    return Object.getOwnPropertySymbols(result.success).includes(ExplainFileSkipTypeId)
  })

  it.prop('∀c_Reason_∈Hint', [ExplainFileSkipCommand], ([command]) => {
    const result = explainFileSkip(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    if (!S.is(FileSkipDecision)(result.success)) {
      return false
    }
    const decision = result.success
    const expectedOwner = expectedOwnerOf(command.extension)
    const namesPackage = expectedOwner === null || decision.reason.includes(expectedOwner)
    const invitesPluginEntry = expectedOwner === null || decision.reason.includes('add it to "plugins"')
    const matchesOwner = S.is(SkipKnownExplained)(decision)
      ? decision.ownerPackage === expectedOwner
      : expectedOwner === null
    return (
      decision.reason.includes(`"${command.extension}"`) &&
      namesPackage &&
      invitesPluginEntry &&
      matchesOwner &&
      decision.extension === command.extension
    )
  })
})
