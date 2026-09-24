import * as S from 'effect/Schema'

export const TestModeSchema = S.Literals(['run', 'skip', 'only', 'todo'])
export type TestMode = S.Schema.Type<typeof TestModeSchema>

export const TestSpecSchema = S.Struct({
  name: S.String.check(S.isMinLength(1), S.isMaxLength(20)),
  mode: TestModeSchema,
  inverted: S.Boolean,
  shouldThrow: S.Boolean,
})
export type TestSpec = S.Schema.Type<typeof TestSpecSchema>

const NonEmptyStringSchema = S.String.check(S.isMinLength(1))

export const DrainPropertySpec = S.Struct({
  timedOut: S.Boolean,
  test: TestSpecSchema,
  lateRejections: S.optional(S.Array(NonEmptyStringSchema)),
})
export type DrainProperty = S.Schema.Type<typeof DrainPropertySpec>

export const RegistryTestSpecSchema = S.Struct({
  name: S.String.check(S.isMinLength(1), S.isMaxLength(20)),
  mode: TestModeSchema,
  suiteName: S.optional(S.String.check(S.isMinLength(1), S.isMaxLength(20))),
  suiteMode: S.optional(TestModeSchema),
})
export type RegistryTestSpec = S.Schema.Type<typeof RegistryTestSpecSchema>

export const RegistrySpecSchema = S.Array(RegistryTestSpecSchema)
