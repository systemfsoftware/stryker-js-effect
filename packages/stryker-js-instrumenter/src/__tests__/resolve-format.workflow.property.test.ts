import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
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

const claimArb = (idPattern: RegExp, extensionPattern: RegExp) =>
  Arbitrary.all({
    formatId: Arbitrary.schema(S.String.check(S.isPattern(idPattern))),
    extensions: Arbitrary.array(Arbitrary.schema(S.String.check(S.isPattern(extensionPattern))), { maxLength: 2 }),
    language: Arbitrary.schema(S.String),
    kind: Arbitrary.schema(S.Literals(['script', 'embedded'])),
  })

const collisionArb = Arbitrary.all({
  fileName: Arbitrary.schema(S.String),
  extension: Arbitrary.schema(S.String.check(S.isPattern(/^\.x[a-z]{0,3}$/))),
  pin: Arbitrary.schema(S.String.check(S.isPattern(/^pin-[a-z]{1,3}$/))),
  byExtension: claimArb(/^ext-[a-z]{1,3}$/, /^\.y[a-z]{0,3}$/),
  byPin: claimArb(/^unused$/, /^\.y[a-z]{0,3}$/),
  decoys: Arbitrary.array(claimArb(/^decoy-[a-z]{1,3}$/, /^\.y[a-z]{0,3}$/), { maxLength: 3 }),
  pinned: Arbitrary.schema(S.Boolean),
  pinClaimed: Arbitrary.schema(S.Boolean),
  extensionClaimed: Arbitrary.schema(S.Boolean),
  position: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 3 }))),
})

type Collision = typeof collisionArb extends Arbitrary.Arbitrary<infer A> ? A : never

const insertedAt = <A>(items: ReadonlyArray<A>, position: number, item: A): ReadonlyArray<A> => [
  ...items.slice(0, position),
  item,
  ...items.slice(position),
]

const collisionCommandOf = (drawn: Collision) => {
  const byExtension = { ...drawn.byExtension, extensions: [...drawn.byExtension.extensions, drawn.extension] }
  const byPin = { ...drawn.byPin, formatId: drawn.pin }
  const withExtension = drawn.extensionClaimed
    ? insertedAt(drawn.decoys, drawn.position, byExtension)
    : drawn.decoys
  const claims = drawn.pinClaimed ? insertedAt(withExtension, drawn.position, byPin) : withExtension
  return {
    byExtension,
    byPin,
    command: FormatResolutionCommand.make({
      fileName: drawn.fileName,
      extension: drawn.extension,
      formatId: drawn.pinned ? drawn.pin : undefined,
      claims,
    }),
  }
}

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
    '∀c_Pinned_≡PinSelectsItsClaimAndNeverFallsBackToTheExtension',
    { of: [collisionArb], subject: resolveFormat },
    (subject, [drawn]) => {
      const { byPin, command } = collisionCommandOf({ ...drawn, pinned: true })
      const result = subject(command)
      if (drawn.pinClaimed) {
        return Result.isSuccess(result) && assignedTo(result.success, drawn.fileName, byPin)
      }
      return Result.isSuccess(result) && S.is(FormatOverrideUnclaimed)(result.success) &&
        result.success.fileName === drawn.fileName && result.success.formatId === drawn.pin
    },
  )

  it.prop(
    '∀c_Unpinned_≡ExtensionSelectsItsClaimOrSkipsTheFile',
    { of: [collisionArb], subject: resolveFormat },
    (subject, [drawn]) => {
      const { byExtension, command } = collisionCommandOf({ ...drawn, pinned: false })
      const result = subject(command)
      if (Result.isFailure(result)) {
        return false
      }
      if (drawn.extensionClaimed) {
        return assignedTo(result.success, drawn.fileName, byExtension)
      }
      return S.is(FormatSkipped)(result.success) && result.success.fileName === drawn.fileName &&
        result.success.extension === drawn.extension
    },
  )
})
