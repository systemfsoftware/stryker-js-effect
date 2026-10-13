import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class BenchRepoEntry extends S.Class<BenchRepoEntry>('BenchRepoEntry')({
  project: S.NonEmptyString,
  mutate: S.NonEmptyArray(S.NonEmptyString),
  testFiles: S.NonEmptyString.pipe(S.NonEmptyArray, S.optionalKey),
}) {}

export class BenchEnterpriseCorpus extends S.Class<BenchEnterpriseCorpus>('BenchEnterpriseCorpus')({
  fixture: S.NonEmptyString,
  config: S.NonEmptyString,
  mutate: S.NonEmptyArray(S.NonEmptyString),
}) {}

export class BenchCorpus extends S.Class<BenchCorpus>('BenchCorpus')({
  repo: S.NonEmptyArray(BenchRepoEntry),
  enterprise: BenchEnterpriseCorpus,
}) {}

export const BenchCorpusJson: S.Codec<BenchCorpus, string> = S.fromJsonString(BenchCorpus)

interface EntryFields {
  readonly project: string
  readonly mutate: ReadonlyArray<string>
  readonly testFiles?: ReadonlyArray<string>
}

interface EnterpriseFields {
  readonly fixture: string
  readonly config: string
  readonly mutate: ReadonlyArray<string>
}

const ENTRY: EntryFields = { project: 'p', mutate: ['m'] }
const ENTERPRISE: EnterpriseFields = { fixture: 'f', config: 'c', mutate: ['m'] }

const entryAccepts = (fields: Partial<EntryFields>): boolean =>
  Result.isSuccess(S.decodeUnknownResult(BenchRepoEntry)({ ...ENTRY, ...fields }))

const enterpriseAccepts = (fields: Partial<EnterpriseFields>): boolean =>
  Result.isSuccess(S.decodeUnknownResult(BenchEnterpriseCorpus)({ ...ENTERPRISE, ...fields }))

const corpusAccepts = (repo: ReadonlyArray<EntryFields>): boolean =>
  Result.isSuccess(S.decodeUnknownResult(BenchCorpus)({ repo, enterprise: ENTERPRISE }))

const textFieldVerdicts = (value: string): ReadonlyArray<boolean> => [
  entryAccepts({ project: value }),
  entryAccepts({ mutate: [value] }),
  entryAccepts({ testFiles: [value] }),
  enterpriseAccepts({ fixture: value }),
  enterpriseAccepts({ config: value }),
  enterpriseAccepts({ mutate: [value] }),
]

const listFieldVerdicts = (length: number): ReadonlyArray<boolean> => {
  const files = Array.from({ length }, () => 'm')
  return [
    entryAccepts({ mutate: files }),
    entryAccepts({ testFiles: files }),
    enterpriseAccepts({ mutate: files }),
    corpusAccepts(Array.from({ length }, () => ENTRY)),
  ]
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀s_BenchCorpusTextFieldRefusal_≡EveryTextFieldRefusesOnlyTheEmptyString',
    { of: [S.String], subject: textFieldVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(['', ' ', 'p'], drawn),
        (value) => Arr.every(subject(value), (accepted) => accepted === value.length > 0),
      ),
  )

  it.prop(
    '∀n_BenchCorpusListFieldRefusal_≡EveryListRefusesOnlyTheEmptyList',
    { of: [S.Int], subject: listFieldVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append([0, 1, 2], Math.abs(drawn) % 5),
        (length) => Arr.every(subject(length), (accepted) => accepted === length > 0),
      ),
  )
}
