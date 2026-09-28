import { SEVERITIES } from '@enterprise/core'
import type { Severity } from '@enterprise/core'

export interface Handler {
  readonly channel: string
}

// @stryker-expect next-line CompileError(TS2739): ObjectLiteral
export const HANDLERS: Record<Severity, Handler> = {
  // @stryker-expect next-line CompileError(TS2741): ObjectLiteral
  info: { channel: 'log' },
  // @stryker-expect next-line CompileError(TS2741): ObjectLiteral
  warning: { channel: 'email' },
  // @stryker-expect next-line CompileError(TS2741): ObjectLiteral
  critical: { channel: 'pager' },
}

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const route = (severity: Severity): Handler => HANDLERS[severity]

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const isKnownSeverity = (candidate: string): candidate is Severity =>
  Object.values(SEVERITIES).some((value) => value === candidate)

// @stryker-expect file KilledOrTimeout: all
