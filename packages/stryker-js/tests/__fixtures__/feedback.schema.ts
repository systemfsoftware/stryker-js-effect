import * as S from 'effect/Schema'

export const JsonRpcResponse = S.Struct({
  id: S.Finite,
  result: S.optional(S.Json),
  error: S.optional(S.Json),
})

export const CallToolResult = S.Struct({
  content: S.Array(S.Struct({ type: S.String, text: S.optional(S.String) })),
  structuredContent: S.optional(S.Json),
  isError: S.optional(S.Boolean),
})

export const SurvivorList = S.Array(
  S.Struct({ id: S.String, fileName: S.String, line: S.Finite }),
)
