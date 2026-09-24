import * as S from 'effect/Schema'

export const OptionValueSchema = S.Union([S.String, S.Finite, S.Boolean, S.Null, S.Undefined])

export const NestedValueSchema = S.Union([OptionValueSchema, S.Record(S.String, OptionValueSchema)])

export const DocumentSchema = S.Record(S.String, OptionValueSchema)

export const NestedDocumentSchema = S.Record(S.String, NestedValueSchema)

export const WarningNameSchema = S.Literals([
  'unknownOptions',
  'preprocessorErrors',
  'unserializableOptions',
  'slow',
])

export const WarningsSchema = S.Union([S.Boolean, S.Record(S.String, S.Boolean)])
