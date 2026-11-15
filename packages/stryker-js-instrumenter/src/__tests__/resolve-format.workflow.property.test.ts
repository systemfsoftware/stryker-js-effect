import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  FormatAssigned,
  FormatClaimSchema,
  FormatOverrideUnclaimed,
  FormatResolutionCommand,
  type FormatResolutionDecision,
  FormatSkipped,
  resolveFormat,
} from '../resolve-format.workflow.js'

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

const claimsArb = Arbitrary.schema(FormatResolutionCommand.fields.claims)

const collisionArb = Arbitrary.all({
  fileName: Arbitrary.schema(FormatResolutionCommand.fields.fileName),
  extension: Arbitrary.schema(FormatResolutionCommand.fields.extension),
  target: Arbitrary.schema(FormatClaimSchema),
  decoy: Arbitrary.schema(FormatClaimSchema),
  before: claimsArb,
  between: claimsArb,
  after: claimsArb,
})

type Collision = typeof collisionArb extends Arbitrary.Arbitrary<infer A> ? A : never

const claimingTheExtension = (claim: Claim, extension: string): Claim => ({
  ...claim,
  extensions: [...claim.extensions, extension],
})

const pinnedCollisionOf = (drawn: Collision): FormatResolutionCommand =>
  FormatResolutionCommand.make({
    fileName: drawn.fileName,
    extension: drawn.extension,
    formatId: drawn.target.formatId,
    claims: [
      ...drawn.before,
      claimingTheExtension(drawn.decoy, drawn.extension),
      ...drawn.between,
      drawn.target,
      ...drawn.after,
    ],
  })

const unpinnedCollisionOf = (drawn: Collision): FormatResolutionCommand =>
  FormatResolutionCommand.make({
    fileName: drawn.fileName,
    extension: drawn.extension,
    formatId: undefined,
    claims: [...drawn.before, claimingTheExtension(drawn.target, drawn.extension), ...drawn.after],
  })

const assignedTo = (
  decision: FormatResolutionDecision,
  fileName: string,
  claim: { readonly formatId: string; readonly language: string; readonly kind: 'script' | 'embedded' },
): boolean =>
  S.is(FormatAssigned)(decision) && decision.fileName === fileName && decision.formatId === claim.formatId &&
  decision.language === claim.language && decision.kind === claim.kind

const verdictTagOf = (result: Result.Result<FormatResolutionDecision, never>): string =>
  Result.match(result, {
    onFailure: () => 'refused',
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('FormatAssigned', () => 'assigned'),
        Match.tag('FormatSkipped', () => 'skipped'),
        Match.tag('FormatOverrideUnclaimed', () => 'unclaimed'),
        Match.exhaustive,
      ),
  })

const verdictOf = (
  left: Result.Result<FormatResolutionDecision, never>,
  right: Result.Result<FormatResolutionDecision, never>,
): boolean => verdictTagOf(left) === verdictTagOf(right)

describe('resolveFormat', () => {
  it.prop(
    '∀c_Command_≡AssignedClaimsCoverTheFile',
    { of: [FormatResolutionCommand], subject: resolveFormat },
    (subject, [command]) => {
      const covering = coveringClaimOf(command)
      const result = subject(command)
      if (Result.isFailure(result)) {
        return false
      }
      const decision = result.success
      if (S.is(FormatOverrideUnclaimed)(decision)) {
        return isPinned(command) && decision.formatId === command.formatId && covering === undefined
      }
      if (S.is(FormatSkipped)(decision)) {
        return decision.extension === command.extension && !isPinned(command) && covering === undefined
      }
      return covering !== undefined && decision.formatId === covering.formatId &&
        decision.language === covering.language && decision.kind === covering.kind
    },
  )

  it.prop(
    '∀c_Command_≡VerdictIgnoresClaimOrder',
    { of: [FormatResolutionCommand], subject: resolveFormat },
    (subject, [command]) => verdictOf(subject(command), subject(reversedCommand(command))),
  )

  it.prop(
    '∀c_Pinned_≡ThePinnedIdSelectsItsClaimEvenWhenAnEarlierClaimTakesTheExtension',
    { of: [collisionArb], subject: resolveFormat },
    (subject, [drawn]) => {
      const command = pinnedCollisionOf(drawn)
      const expected = coveringClaimOf(command)
      const result = subject(command)
      return expected !== undefined && expected.formatId === drawn.target.formatId && Result.isSuccess(result) &&
        assignedTo(result.success, drawn.fileName, expected)
    },
  )

  it.prop(
    '∀c_Unpinned_≡TheFirstClaimOfTheExtensionIsAssigned',
    { of: [collisionArb], subject: resolveFormat },
    (subject, [drawn]) => {
      const command = unpinnedCollisionOf(drawn)
      const expected = coveringClaimOf(command)
      const result = subject(command)
      return expected !== undefined && Result.isSuccess(result) && assignedTo(result.success, drawn.fileName, expected)
    },
  )
})
