import * as S from 'effect/Schema'

export const HumanReporterSchema = S.Literal('clear-text')
export const ProgressReporterSchema = S.Literal('progress')
export const StreamReporterSchema = S.Literal('progress-stream')
export const JsonReporterSchema = S.Literal('json')

export const StdoutReporterSchema = S.Union([HumanReporterSchema, ProgressReporterSchema])
export type StdoutReporter = typeof StdoutReporterSchema.Type

export const ReporterNameSchema = S.Union([
  HumanReporterSchema,
  ProgressReporterSchema,
  StreamReporterSchema,
  JsonReporterSchema,
])
export type ReporterName = typeof ReporterNameSchema.Type
