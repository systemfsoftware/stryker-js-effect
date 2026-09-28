// @stryker-expect next-line CompileError(TS2322): StringLiteral
export const PAYLOAD_KIND = 'payload' as const

export type PayloadKind = typeof PAYLOAD_KIND
