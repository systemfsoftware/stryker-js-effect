import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const SpanName = S.String.check(
  S.isPattern(/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/u, {
    expected: 'a dot-separated span name whose segments start with a letter, such as "stryker.checker.check"',
  }),
).pipe(S.brand('SpanName'))
export type SpanName = typeof SpanName.Type

export const SpanAttributeKey = S.String.check(
  S.isPattern(/^[A-Za-z][A-Za-z0-9_.-]*$/u, {
    expected: 'an attribute key starting with a letter, such as "stryker.checker.name"',
  }),
).pipe(S.brand('SpanAttributeKey'))
export type SpanAttributeKey = typeof SpanAttributeKey.Type

/**
 * One declared span as the taxonomy carries it: its name and the schema of every
 * attribute its site sets. `id` is not stored because the published document
 * derives it from the name, so a rename cannot leave a stale identity behind.
 */
export interface SpanMember {
  readonly name: string
  readonly attributes: Readonly<Record<string, S.Top>>
}

export const SpanAttributeText = S.String

export const SpanAttributeCount = S.Finite

export const SpanAttributeCountWhenRecorded = S.optionalKey(SpanAttributeCount)

export const SpanRunStatus = S.Literals(['success', 'failure', 'timed_out', 'aborted', 'skipped'])
export type SpanRunStatus = typeof SpanRunStatus.Type

/**
 * What one checker compile records about the importer shortcut: how many mutants took it, and, for the mutants that
 * did not, how many fell back for each reason. The counts are recorded when the compile completes, so a compile that
 * fails first records none, and a reason's count is recorded only when some mutant fell back for it.
 */
export const ImporterShortcutAttributes = {
  'typescript.importer_shortcut.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.original.outside-function-body.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.original.body-dependent-signature.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.original.not-typescript-module.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.original.module-reference.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.original.syntax-error.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.original.shared-file.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.mutated.outside-function-body.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.mutated.body-dependent-signature.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.mutated.not-typescript-module.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.mutated.module-reference.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.mutated.syntax-error.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.mutated.shared-file.count': SpanAttributeCountWhenRecorded,
  'typescript.importer_shortcut.fallback.unread.count': SpanAttributeCountWhenRecorded,
} as const

export const CompilerCheckAttributes = {
  'typescript.snapshot_updates.count': SpanAttributeCountWhenRecorded,
  'typescript.resplices.count': SpanAttributeCountWhenRecorded,
  ...ImporterShortcutAttributes,
} as const

export const SpanDocument = S.Struct({
  id: SpanName,
  name: SpanName,
  attributes: S.Record(SpanAttributeKey, S.Json),
})
export type SpanDocument = typeof SpanDocument.Type

const idsAreUnique = S.makeFilter(
  (documents: ReadonlyArray<SpanDocument>): string | undefined => {
    const duplicated = Mutant.duplicatedValue(documents.map((document) => document.id))
    return duplicated === undefined ? undefined : `span taxonomy documents share the id "${duplicated}"`
  },
  { arbitraryConstraint: { uniqueBy: (document: SpanDocument) => document.id } },
)

export const SpanDocuments = S.Array(SpanDocument).check(idsAreUnique)
export type SpanDocuments = typeof SpanDocuments.Type

const boundaryNames = [
  '',
  'prepare',
  'dryRun',
  'mutationTest.batch',
  'stryker.cli.run',
  'typescript-checker.check',
  '9prepare',
  'stryker..cli',
  'stryker.cli.',
  '.cli',
  'stryker cli',
  'stryker/cli',
  'stryker.9cli',
  'A.-',
]

const boundaryAttributeKeys = ['', 'fileCount', 'stryker.checker.name', 'rpc.method', '9count', '_count']

const segmentReadsAsSpanName = (segment: string): boolean =>
  /^[A-Za-z]/.test(segment) && /^[A-Za-z0-9_-]+$/.test(segment)

const readsAsSpanName = (value: string): boolean => value.split('.').every(segmentReadsAsSpanName)

const readsAsAttributeKey = (value: string): boolean => /^[A-Za-z]/.test(value) && /^[A-Za-z0-9_.-]+$/.test(value)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Result = await import('effect/Result')

  const withBoundaries = (drawn: string): ReadonlyArray<string> => Arr.prepend(boundaryNames, drawn)

  const withAttributeKeyBoundaries = (drawn: string): ReadonlyArray<string> => Arr.prepend(boundaryAttributeKeys, drawn)

  it.prop(
    '∀n_SpanNameRefusal_≡EveryDotSegmentStartsALetter',
    { of: [S.String], subject: S.is(SpanName) },
    (subject, [drawn]) => Arr.every(withBoundaries(drawn), (value) => subject(value) === readsAsSpanName(value)),
  )

  it.prop(
    '∀k_SpanAttributeKeyRefusal_≡KeysStartALetter',
    { of: [S.String], subject: S.is(SpanAttributeKey) },
    (subject, [drawn]) =>
      Arr.every(withAttributeKeyBoundaries(drawn), (value) => subject(value) === readsAsAttributeKey(value)),
  )

  const refusalOf = (documents: typeof SpanDocuments.Encoded): string | undefined =>
    Result.match(S.decodeResult(SpanDocuments)(documents), {
      onFailure: (error) => error.message,
      onSuccess: () => undefined,
    })

  it.prop(
    '∀d_SpanDocumentsIdDuplication_≡RefusedNamingTheId',
    { of: [SpanDocument], subject: refusalOf },
    (subject, [candidate]) => {
      const message = subject([candidate, { ...candidate, name: candidate.name }])
      return message !== undefined && message.includes(candidate.id)
    },
  )
}
