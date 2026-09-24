import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const FrameworkClaimant = S.Struct({
  package: S.String,
  extensions: S.Array(S.String),
})
export type FrameworkClaimant = S.Schema.Type<typeof FrameworkClaimant>

export class ExplainFileSkipCommand extends S.TaggedClass<ExplainFileSkipCommand>()(
  'ExplainFileSkipCommand',
  {
    extension: S.String,
    claimants: S.Array(FrameworkClaimant),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    extension: 'stryker.file_skip.extension',
  } as const
}

const ExplainFileSkipTypeId = Symbol.for('@systemfsoftware/stryker-js/ExplainFileSkipDecision')
type ExplainFileSkipTypeId = typeof ExplainFileSkipTypeId

export class FileSkipExplained extends S.TaggedClass<FileSkipExplained>()('FileSkipExplained', {
  extension: S.String,
  reason: S.String,
  ownerPackage: S.NullOr(S.String),
}) {
  readonly [ExplainFileSkipTypeId] = ExplainFileSkipTypeId
}

export class SkipKnownExplained extends S.TaggedClass<SkipKnownExplained>()('SkipKnownExplained', {
  extension: S.String,
  reason: S.String,
  ownerPackage: S.String,
}) {
  readonly [ExplainFileSkipTypeId] = ExplainFileSkipTypeId
}

export class SkipUnknownExplained extends S.TaggedClass<SkipUnknownExplained>()('SkipUnknownExplained', {
  extension: S.String,
  reason: S.String,
}) {
  readonly [ExplainFileSkipTypeId] = ExplainFileSkipTypeId
}

export const FileSkipDecision = S.Union([SkipKnownExplained, SkipUnknownExplained])
export type FileSkipDecision = typeof FileSkipDecision.Type

const claimantsOf = (command: ExplainFileSkipCommand): readonly string[] =>
  command.claimants
    .filter((claimant) => claimant.extensions.includes(command.extension))
    .map((claimant) => claimant.package)

const claimedReasonOf = (extension: string, claimants: readonly string[]): string =>
  `No loaded framework claims "${extension}". Add ${claimants.join(', ')} to "plugins" to instrument it.`

const unclaimedReasonOf = (extension: string): string =>
  `No loaded framework claims "${extension}". No installed package declares it as a framework plugin: install the framework plugin that claims this file type and add it to "plugins" to instrument it.`

const explainedOf = (command: ExplainFileSkipCommand): FileSkipExplained => {
  const claimants = claimantsOf(command)
  return Match.value(claimants.length > 0).pipe(
    Match.when(true, () =>
      FileSkipExplained.make({
        extension: command.extension,
        reason: claimedReasonOf(command.extension, claimants),
        ownerPackage: Option.getOrNull(Option.fromUndefinedOr(claimants.at(0))),
      })),
    Match.orElse(() =>
      FileSkipExplained.make({
        extension: command.extension,
        reason: unclaimedReasonOf(command.extension),
        ownerPackage: null,
      })
    ),
  )
}

const skipKnownOrUnknownOf = (
  explained: FileSkipExplained,
): SkipKnownExplained | SkipUnknownExplained =>
  Option.match(Option.fromNullishOr(explained.ownerPackage), {
    onNone: () => SkipUnknownExplained.make({ extension: explained.extension, reason: explained.reason }),
    onSome: (ownerPackage) =>
      SkipKnownExplained.make({
        extension: explained.extension,
        reason: explained.reason,
        ownerPackage,
      }),
  })

export const explainFileSkip = Workflow.make({
  command: ExplainFileSkipCommand,
  decision: FileSkipDecision,
  error: S.Never,
  decide: (command): Result.Result<FileSkipDecision, never> =>
    Match.value(skipKnownOrUnknownOf(explainedOf(command))).pipe(
      Match.tag('SkipKnownExplained', (known) => Result.succeed(known)),
      Match.tag('SkipUnknownExplained', (unknown) => Result.succeed(unknown)),
      Match.exhaustive,
    ),
})
