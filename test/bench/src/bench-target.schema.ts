import { BenchEnterpriseCorpus, BenchRepoEntry } from '@systemfsoftware/stryker-e2e-core'
import * as S from 'effect/Schema'

export const BenchTarget = S.TaggedUnion({
  repo: { entry: BenchRepoEntry },
  enterprise: { corpus: BenchEnterpriseCorpus },
})
export type BenchTarget = typeof BenchTarget.Type
