import { Schema as S } from 'effect'

export class StrykerError extends S.TaggedError<StrykerError, { readonly brand: unique symbol }>()('StrykerError', {
  message: S.String,
  cause: S.optional(S.Unknown),
}) {}

export class ReporterStageForged
  extends S.TaggedError<ReporterStageForged, { readonly brand: unique symbol }>()('ReporterStageForged', {})
{
  override get message(): string {
    return 'Reporter stage is missing its attachments'
  }
}

export class ReporterFactoryThrew
  extends S.TaggedError<ReporterFactoryThrew, { readonly brand: unique symbol }>()('ReporterFactoryThrew', {
    reporterName: S.String,
    message: S.String,
    cause: S.Defect(),
  })
{}
