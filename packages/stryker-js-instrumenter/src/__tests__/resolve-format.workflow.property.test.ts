import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  FormatAssigned,
  FormatOverrideUnclaimed,
  FormatResolutionCommand,
  type FormatResolutionDecision,
  FormatSkipped,
  resolveFormat,
} from '../resolve-format.workflow.js'

const FormatResolutionDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/FormatResolutionDecision',
)

type Claim = FormatResolutionCommand['claims'][number]

const isPinned = (command: FormatResolutionCommand): boolean => command.formatId !== undefined

const coversFile = (command: FormatResolutionCommand, claim: Claim): boolean =>
  isPinned(command) ? claim.formatId === command.formatId : claim.extensions.includes(command.extension)

const coveringClaimOf = (command: FormatResolutionCommand): Claim | undefined =>
  command.claims.find((claim) => coversFile(command, claim))

const reversedCommand = (command: FormatResolutionCommand): FormatResolutionCommand =>
  FormatResolutionCommand.make({
    fileName: command.fileName,
    extension: command.extension,
    formatId: command.formatId,
    claims: [...command.claims].reverse(),
  })

const verdictOf = (
  left: Result.Result<FormatResolutionDecision, FormatOverrideUnclaimed>,
  right: Result.Result<FormatResolutionDecision, FormatOverrideUnclaimed>,
): boolean =>
  (Result.isFailure(left) && Result.isFailure(right)) ||
  (Result.isSuccess(left) && Result.isSuccess(right) &&
    S.is(FormatAssigned)(left.success) === S.is(FormatAssigned)(right.success))

const hasBrand = (decision: FormatResolutionDecision): boolean =>
  Object.getOwnPropertySymbols(decision).includes(FormatResolutionDecisionTypeId)

describe('resolveFormat', () => {
  it.prop(
    '∀d_Brand_∈Decision',
    [FormatAssigned, FormatSkipped],
    ([assigned, skipped]) => hasBrand(assigned) && hasBrand(skipped),
  )

  it.prop('∀c_Command_≡AssignedClaimsCoverTheFile', [FormatResolutionCommand], ([command]) => {
    const covering = coveringClaimOf(command)
    const result = resolveFormat(command)
    if (Result.isFailure(result)) {
      return (
        S.is(FormatOverrideUnclaimed)(result.failure) && isPinned(command) &&
        result.failure.formatId === command.formatId && covering === undefined
      )
    }
    const decision = result.success
    if (S.is(FormatSkipped)(decision)) {
      return decision.extension === command.extension && !isPinned(command) && covering === undefined
    }
    return covering !== undefined && decision.formatId === covering.formatId &&
      decision.language === covering.language && decision.kind === covering.kind
  })

  it.prop(
    '∀c_Command_≡VerdictIgnoresClaimOrder',
    [FormatResolutionCommand],
    ([command]) => verdictOf(resolveFormat(command), resolveFormat(reversedCommand(command))),
  )
})
