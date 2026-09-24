import { Schema } from 'effect'

export const ExecResult = Schema.Struct({
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
})

export type ExecResult = typeof ExecResult.Type
