import * as S from 'effect/Schema'

export const BaseCommandFieldsSchema = S.Struct({
  salt: S.String,
  specifier: S.String,
  resolvedUrl: S.optional(S.String),
  isBuiltin: S.Boolean,
})
export type BaseCommandFields = S.Schema.Type<typeof BaseCommandFieldsSchema>

export const RedirectedCommandFieldsSchema = S.Struct({
  ...BaseCommandFieldsSchema.fields,
  redirectPath: S.String,
})
