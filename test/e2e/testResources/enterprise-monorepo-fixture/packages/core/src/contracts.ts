export const SEVERITIES = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
} as const

export type Severity = (typeof SEVERITIES)[keyof typeof SEVERITIES]
