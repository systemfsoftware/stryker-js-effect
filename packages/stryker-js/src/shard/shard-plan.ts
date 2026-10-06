import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ShardPlanInvalid } from './shard-plan.schema.js'

export interface LoadedShardPlan {
  readonly plan: ShardPlan
  readonly file: string
  readonly directory: string
}

const decodeShardPlan = S.decodeUnknownResult(S.fromJsonString(ShardPlan))

export const loadShardPlan: {
  (
    basePath: string,
    file: string,
  ): Effect.Effect<LoadedShardPlan, ShardPlanInvalid, FileSystem.FileSystem | Path.Path>
  (
    file: string,
  ): (basePath: string) => Effect.Effect<LoadedShardPlan, ShardPlanInvalid, FileSystem.FileSystem | Path.Path>
} = dual(2, (basePath: string, file: string): Effect.Effect<
  LoadedShardPlan,
  ShardPlanInvalid,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const resolved = path.resolve(basePath, file)
    const text = yield* fs.readFileString(resolved).pipe(
      Effect.mapError(() => ShardPlanInvalid.make({ file, reason: 'cannot read the plan file' })),
    )
    const plan = yield* Effect.fromResult(
      Result.mapError(
        decodeShardPlan(text),
        (error) => ShardPlanInvalid.make({ file, reason: error.message }),
      ),
    )
    return { plan, file: resolved, directory: path.dirname(resolved) }
  }))
