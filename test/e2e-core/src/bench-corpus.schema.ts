import * as S from 'effect/Schema'

export class BenchRepoEntry extends S.Class<BenchRepoEntry>('BenchRepoEntry')({
  project: S.NonEmptyString,
  mutate: S.NonEmptyArray(S.NonEmptyString),
}) {}

export class BenchEnterpriseCorpus extends S.Class<BenchEnterpriseCorpus>('BenchEnterpriseCorpus')({
  fixture: S.NonEmptyString,
  config: S.NonEmptyString,
}) {}

export class BenchCorpus extends S.Class<BenchCorpus>('BenchCorpus')({
  repo: S.NonEmptyArray(BenchRepoEntry),
  enterprise: BenchEnterpriseCorpus,
}) {}

export const BenchCorpusJson: S.Codec<BenchCorpus, string> = S.fromJsonString(BenchCorpus)
