import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type { GitCommandFailed } from '../git-diff.schema.js'
import { GitDiff } from '../git-diff.service.js'
import { admitPlanHead, AdmitPlanHeadCommand, type AdmitPlanHeadError } from './admit-plan-head.workflow.js'
import { ShardPlanInvalid } from './shard-plan.schema.js'

export interface LoadedShardPlan {
  readonly plan: ShardPlan
  readonly file: string
  readonly directory: string
}

const MISSING_IDS_NAMED = 5

const missingIdsTextOf = (missingIds: ReadonlyArray<string>): string =>
  `${missingIds.slice(0, MISSING_IDS_NAMED).join(', ')}${
    Option.match(Option.liftPredicate(missingIds.length - MISSING_IDS_NAMED, (rest) => rest > 0), {
      onNone: () => '',
      onSome: (rest) => `, +${rest} more`,
    })
  }`

export class ShardPlanMutantsMissing extends S.TaggedError<ShardPlanMutantsMissing>()('ShardPlanMutantsMissing', {
  planFile: S.String,
  missingIds: S.Array(S.String),
}) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `the shard plan at ${this.planFile} schedules ${this.missingIds.length} mutant(s) this run does not discover: ${
      missingIdsTextOf(this.missingIds)
    }; re-run stryker plan`
  }
}

export const missingPlannedMutants: (input: {
  readonly planFile: string
  readonly planned: ReadonlyArray<string>
  readonly discovered: ReadonlyArray<string>
}) => Option.Option<ShardPlanMutantsMissing> = ({ planFile, planned, discovered }) => {
  const discoveredIds = new Set(discovered)
  const missingIds = Arr.filter(Arr.dedupe(planned), (id) => !discoveredIds.has(id))
  return Option.map(Arr.head(missingIds), () => ShardPlanMutantsMissing.make({ planFile, missingIds }))
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
      Effect.mapError(() =>
        ShardPlanInvalid.make({
          file,
          detail: 'cannot read the plan file',
          code: 'plan-unreadable',
          next: 'check the --plan path',
        })
      ),
    )
    const plan = yield* Effect.fromResult(
      Result.mapError(
        decodeShardPlan(text),
        (error) =>
          ShardPlanInvalid.make({
            file,
            detail: error.message,
            code: 'plan-undecodable',
            next: 'stryker plan --since <base>',
          }),
      ),
    )
    return { plan, file: resolved, directory: path.dirname(resolved) }
  }))

export const admitLoadedPlan: {
  (
    basePath: string,
    loaded: LoadedShardPlan,
  ): Effect.Effect<LoadedShardPlan, AdmitPlanHeadError | GitCommandFailed, GitDiff>
  (
    loaded: LoadedShardPlan,
  ): (basePath: string) => Effect.Effect<LoadedShardPlan, AdmitPlanHeadError | GitCommandFailed, GitDiff>
} = dual(2, (basePath: string, loaded: LoadedShardPlan): Effect.Effect<
  LoadedShardPlan,
  AdmitPlanHeadError | GitCommandFailed,
  GitDiff
> =>
  Match.value(loaded.plan.scope).pipe(
    Match.tag('Unscoped', () => Effect.succeed(loaded)),
    Match.tag('DiffScoped', 'FullScope', (scope) =>
      Effect.gen(function*() {
        const git = yield* GitDiff
        const head = yield* git.head(basePath)
        const sources = yield* git.sourceDigest({ cwd: basePath, paths: scope.files })
        yield* Effect.fromResult(admitPlanHead(AdmitPlanHeadCommand.make({ scope, head, sources })))
        return loaded
      })),
    Match.exhaustive,
  ))

export const loadAdmittedPlan = (
  basePath: string,
  file: string,
): Effect.Effect<
  LoadedShardPlan,
  ShardPlanInvalid | AdmitPlanHeadError | GitCommandFailed,
  FileSystem.FileSystem | Path.Path | GitDiff
> => loadShardPlan(basePath, file).pipe(Effect.flatMap((loaded) => admitLoadedPlan(basePath, loaded)))

export const planVerifiedAt = (
  basePath: string,
  loaded: LoadedShardPlan,
): Effect.Effect<boolean, AdmitPlanHeadError, GitDiff> =>
  admitLoadedPlan(basePath, loaded).pipe(
    Effect.as(true),
    Effect.catchTag('GitCommandFailed', () => Effect.succeed(false)),
  )
