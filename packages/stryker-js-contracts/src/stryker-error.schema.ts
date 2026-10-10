import { Schema as S } from 'effect'

export class StrykerError extends S.TaggedError<StrykerError>()('StrykerError', {
  message: S.String,
  cause: S.optional(S.Unknown),
}) {}

export class ReporterStageForged extends S.TaggedError<ReporterStageForged>()('ReporterStageForged', {}) {
  override get message(): string {
    return 'Reporter stage is missing its attachments'
  }
}

export class ReporterFactoryThrew extends S.TaggedError<ReporterFactoryThrew>()('ReporterFactoryThrew', {
  reporterName: S.String,
  message: S.String,
  cause: S.Defect(),
}) {}
