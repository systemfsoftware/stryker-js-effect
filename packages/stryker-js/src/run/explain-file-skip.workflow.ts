import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class ExplainFileSkipCommand extends S.TaggedClass<ExplainFileSkipCommand>()(
  'ExplainFileSkipCommand',
  {
    extension: S.String,
  },
) {}

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

const ANGULAR_MODULE = '@systemfsoftware/stryker-js-angular'
const SVELTE_MODULE = '@systemfsoftware/stryker-js-svelte'

const ownerOf = (extension: string): string | null =>
  Match.value(extension).pipe(
    Match.when('.svelte', () => SVELTE_MODULE),
    Match.when('.html', () => ANGULAR_MODULE),
    Match.when('.htm', () => ANGULAR_MODULE),
    Match.when('.vue', () => ANGULAR_MODULE),
    Match.orElse(() => null),
  )

const reasonText = (extension: string, owner: string | null): string =>
  Match.value(owner).pipe(
    Match.when(
      null,
      () =>
        `No loaded framework claims "${extension}". Install the framework plugin that claims this file type to instrument it.`,
    ),
    Match.orElse(
      (moduleName) =>
        `No loaded framework claims "${extension}". Install ${moduleName} and add it to "plugins" to instrument it.`,
    ),
  )

const skipExplainedOf = (command: ExplainFileSkipCommand): FileSkipExplained => {
  const owner = ownerOf(command.extension)
  return FileSkipExplained.make({
    extension: command.extension,
    reason: reasonText(command.extension, owner),
    ownerPackage: owner,
  })
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

export const explainFileSkip = Workflow.total(
  ExplainFileSkipCommand,
  (command) =>
    Match.value(skipKnownOrUnknownOf(skipExplainedOf(command))).pipe(
      Match.tag('SkipKnownExplained', (known) => Result.succeed(known)),
      Match.tag('SkipUnknownExplained', (unknown) => Result.succeed(unknown)),
      Match.exhaustive,
    ),
)
