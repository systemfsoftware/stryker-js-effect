import { SEVERITIES } from '@enterprise/core'
import type { Severity } from '@enterprise/core'

export interface Handler {
  readonly channel: string
}

export const HANDLERS: Record<Severity, Handler> = {
  info: { channel: 'log' },
  warning: { channel: 'email' },
  critical: { channel: 'pager' },
}

export const route = (severity: Severity): Handler => HANDLERS[severity]

export const isKnownSeverity = (candidate: string): candidate is Severity =>
  Object.values(SEVERITIES).some((value) => value === candidate)
