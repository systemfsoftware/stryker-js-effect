import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const FormatClaimSchema = S.Struct({
  formatId: S.String,
  extensions: S.Array(S.String),
  language: S.String,
  kind: S.Literals(['script', 'embedded']),
})

type FormatClaimInput = typeof FormatClaimSchema.Type

export class FormatResolutionCommand extends S.TaggedClass<FormatResolutionCommand>()('FormatResolutionCommand', {
  fileName: S.String,
  extension: S.String,
  formatId: S.optional(S.String),
  claims: S.Array(FormatClaimSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const FormatResolutionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/FormatResolutionDecision',
)
type FormatResolutionTypeId = typeof FormatResolutionTypeId

export class FormatAssigned extends S.TaggedClass<FormatAssigned>()('FormatAssigned', {
  fileName: S.String,
  formatId: S.String,
  language: S.String,
  kind: S.Literals(['script', 'embedded']),
}) {
  readonly [FormatResolutionTypeId] = FormatResolutionTypeId
}

export class FormatSkipped extends S.TaggedClass<FormatSkipped>()('FormatSkipped', {
  fileName: S.String,
  extension: S.String,
  reason: S.String,
}) {
  readonly [FormatResolutionTypeId] = FormatResolutionTypeId
}

export type FormatResolutionDecision = FormatAssigned | FormatSkipped

export class FormatOverrideUnclaimed extends S.TaggedError<FormatOverrideUnclaimed>()('FormatOverrideUnclaimed', {
  fileName: S.String,
  formatId: S.String,
  reason: S.String,
}) {}

const pinOf = (command: FormatResolutionCommand): Option.Option<string> => Option.fromUndefinedOr(command.formatId)

const matchesCommand = (claim: FormatClaimInput, command: FormatResolutionCommand): boolean =>
  Match.value(pinOf(command)).pipe(
    Match.when(Option.isSome, (pin) => claim.formatId === pin.value),
    Match.orElse(() => claim.extensions.includes(command.extension)),
  )

const claimFor = (command: FormatResolutionCommand): FormatClaimInput | undefined =>
  command.claims.find((claim) => matchesCommand(claim, command))

const assignedFrom = (claim: FormatClaimInput, command: FormatResolutionCommand): FormatAssigned =>
  FormatAssigned.make({
    fileName: command.fileName,
    formatId: claim.formatId,
    language: claim.language,
    kind: claim.kind,
  })

const skippedFrom = (command: FormatResolutionCommand): FormatSkipped =>
  FormatSkipped.make({
    fileName: command.fileName,
    extension: command.extension,
    reason:
      `No installed format claims "${command.extension}". Install the framework plugin that claims this file type to instrument it.`,
  })

const overrideUnclaimedFrom = (command: FormatResolutionCommand, formatId: string): FormatOverrideUnclaimed =>
  FormatOverrideUnclaimed.make({
    fileName: command.fileName,
    formatId,
    reason: `No installed format carries the id "${formatId}" pinned for this file.`,
  })

const ClaimSelected = S.TaggedStruct('ClaimSelected', { claim: FormatClaimSchema })
const PinUnclaimed = S.TaggedStruct('PinUnclaimed', { formatId: S.String })
const ExtensionUnclaimed = S.TaggedStruct('ExtensionUnclaimed', {})
const ClaimSelection = S.Union([ClaimSelected, PinUnclaimed, ExtensionUnclaimed])
type ClaimSelection = S.Schema.Type<typeof ClaimSelection>

const selectionFor = (command: FormatResolutionCommand): ClaimSelection =>
  Option.match(Option.fromUndefinedOr(claimFor(command)), {
    onNone: () =>
      Option.match(pinOf(command), {
        onNone: (): ClaimSelection => ExtensionUnclaimed.make({}),
        onSome: (formatId): ClaimSelection => PinUnclaimed.make({ formatId }),
      }),
    onSome: (claim): ClaimSelection => ClaimSelected.make({ claim }),
  })

export const resolveFormat = Workflow.make({
  command: FormatResolutionCommand,
  decision: S.Union([FormatAssigned, FormatSkipped]),
  error: FormatOverrideUnclaimed,
  decide: (command): Result.Result<FormatResolutionDecision, FormatOverrideUnclaimed> =>
    Match.value(selectionFor(command)).pipe(
      Match.tag('ClaimSelected', ({ claim }) => Result.succeed(assignedFrom(claim, command))),
      Match.tag('PinUnclaimed', ({ formatId }) => Result.fail(overrideUnclaimedFrom(command, formatId))),
      Match.tag('ExtensionUnclaimed', () => Result.succeed(skippedFrom(command))),
      Match.exhaustive,
    ),
})
