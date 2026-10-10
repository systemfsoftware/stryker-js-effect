import { Schema as S } from 'effect'

export class BenchSetupFailed extends S.TaggedError<BenchSetupFailed>()('BenchSetupFailed', {
  step: S.String,
  detail: S.String,
  cause: S.optional(S.Unknown),
}) {
  override get message(): string {
    return `${this.step}: ${this.detail}`
  }
}

export const PackageEntrypoints = S.Struct({
  exports: S.Struct({
    '.': S.Struct({ default: S.String }),
  }),
})

export const TurboTask = S.Struct({
  package: S.optional(S.String),
  command: S.optional(S.String),
  taskId: S.String,
})
export type TurboTask = typeof TurboTask.Type

export const TurboDryRun = S.Struct({ tasks: S.Array(TurboTask) })

export const WorkspaceListing = S.Struct({ name: S.optional(S.String) })
