import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import {
  FormatAssigned,
  FormatOverrideUnclaimed,
  FormatResolutionCommand,
  FormatSkipped,
  resolveFormat,
} from '../resolve-format.workflow.js'

const FormatResolutionDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/FormatResolutionDecision',
)

type Claim = (typeof FormatResolutionCommand.Type)['claims'][number]

const isPinned = (command: FormatResolutionCommand): boolean => command.formatId !== undefined

const coversFile = (command: FormatResolutionCommand, claim: Claim): boolean =>
  isPinned(command) ? claim.formatId === command.formatId : claim.extensions.includes(command.extension)

const coveringClaimOf = (command: FormatResolutionCommand): Claim | undefined =>
  command.claims.find((claim) => coversFile(command, claim))

const commandWithCoveringClaim = S.toArbitrary(FormatResolutionCommand)(fc).map((command) => ({
  command,
  covering: coveringClaimOf(command),
}))

const reversedCommand = (command: FormatResolutionCommand): FormatResolutionCommand =>
  new FormatResolutionCommand({
    fileName: command.fileName,
    extension: command.extension,
    formatId: command.formatId,
    claims: [...command.claims].reverse(),
  })

const sameVerdict = (
  left: Result.Result<unknown, unknown>,
  right: Result.Result<unknown, unknown>,
): boolean =>
  (Result.isFailure(left) && Result.isFailure(right)) ||
  (Result.isSuccess(left) && Result.isSuccess(right) &&
    S.is(FormatAssigned)(left.success) === S.is(FormatAssigned)(right.success))

describe('resolveFormat', () => {
  it.prop(
    '∀d_Brand_∈Decision',
    [
      fc.constantFrom(
        new FormatAssigned({ fileName: 'a.ts', formatId: 'ts', language: 'typescript', kind: 'script' }),
        new FormatSkipped({ fileName: 'a.txt', extension: '.txt', reason: 'unclaimed' }),
      ),
    ],
    ([decision]) => Object.getOwnPropertySymbols(decision).includes(FormatResolutionDecisionTypeId),
  )

  it.prop('∀c_Command_≡AssignedClaimsCoverTheFile', [commandWithCoveringClaim], ([{ command, covering }]) => {
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
    [S.toArbitrary(FormatResolutionCommand)(fc)],
    ([command]) => sameVerdict(resolveFormat(command), resolveFormat(reversedCommand(command))),
  )
})
