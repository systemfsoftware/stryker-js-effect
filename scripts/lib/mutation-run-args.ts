export interface ShardRef {
  readonly index: number
  readonly count: number
}

export const incrementalFileOf = (shard: ShardRef | undefined): string =>
  shard === undefined
    ? 'reports/stryker-incremental.json'
    : `reports/stryker-incremental-${shard.index}of${shard.count}.json`

export const PUBLISHED_CLI_FULL_RUN_FLAG = '--force'

export const publishedCliRunArgsOf = (shard: ShardRef | undefined): ReadonlyArray<string> => [
  '--incrementalFile',
  incrementalFileOf(shard),
  PUBLISHED_CLI_FULL_RUN_FLAG,
]
