import * as S from 'effect/Schema'

import { BenchEnterpriseCorpus, BenchRepoEntry } from './bench-corpus.schema.js'

export const BenchTarget = S.TaggedUnion({
  repo: { entry: BenchRepoEntry },
  enterprise: { corpus: BenchEnterpriseCorpus },
})
export type BenchTarget = typeof BenchTarget.Type
