import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type FormatIdentity, FormatIdentitySchema } from './IncrementalDiff.schema.js'

export class AdmitFileIdentityCommand extends S.TaggedClass<AdmitFileIdentityCommand>()(
  'AdmitFileIdentityCommand',
  {
    file: S.String,
    recorded: S.optional(FormatIdentitySchema),
    claimed: S.optional(FormatIdentitySchema),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    file: 'stryker.file_identity.file',
  } as const
}

const FileIdentityDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/FileIdentityDecision')
type FileIdentityDecisionTypeId = typeof FileIdentityDecisionTypeId

export class FileIdentityReuse extends S.TaggedClass<FileIdentityReuse>()('FileIdentityReuse', {
  file: S.String,
}) {
  readonly [FileIdentityDecisionTypeId] = FileIdentityDecisionTypeId
}

export class FileIdentityRecompute extends S.TaggedClass<FileIdentityRecompute>()('FileIdentityRecompute', {
  file: S.String,
}) {
  readonly [FileIdentityDecisionTypeId] = FileIdentityDecisionTypeId
}

export const FileIdentityDecisionSchema = S.Union([FileIdentityReuse, FileIdentityRecompute])
export type FileIdentityDecision = typeof FileIdentityDecisionSchema.Type

const sameIdentity = (left: FormatIdentity, right: FormatIdentity): boolean =>
  [
    [left.formatId, right.formatId],
    [left.ownerModule, right.ownerModule],
    [left.ownerVersion, right.ownerVersion],
  ].every(([actual, expected]) => actual === expected)

const decideFileIdentity = (command: AdmitFileIdentityCommand): FileIdentityDecision =>
  Option.match(
    Option.all({
      recorded: Option.fromUndefinedOr(command.recorded),
      claimed: Option.fromUndefinedOr(command.claimed),
    }),
    {
      onNone: () => FileIdentityRecompute.make({ file: command.file }),
      onSome: ({ recorded, claimed }) =>
        Match.value(sameIdentity(recorded, claimed)).pipe(
          Match.when(true, () => FileIdentityReuse.make({ file: command.file })),
          Match.orElse(() => FileIdentityRecompute.make({ file: command.file })),
        ),
    },
  )

export const admitFileIdentity = Workflow.make({
  command: AdmitFileIdentityCommand,
  decision: FileIdentityDecisionSchema,
  error: S.Never,
  decide: (command): Result.Result<FileIdentityDecision, never> => Result.succeed(decideFileIdentity(command)),
})
