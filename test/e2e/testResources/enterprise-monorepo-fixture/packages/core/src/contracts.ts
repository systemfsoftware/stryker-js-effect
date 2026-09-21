export const SEVERITIES = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
} as const

export type Severity = (typeof SEVERITIES)[keyof typeof SEVERITIES]

declare const EntityBrand: unique symbol
export type EntityId = string & { readonly [EntityBrand]: 'EntityId' }
export const entityId = (id: string): EntityId => id as EntityId

export interface InfoMetricEvent {
  readonly type: 'metric'
  readonly name: string
  readonly value: number
  readonly severity: 'info'
}

export interface SecurityAlertEvent {
  readonly type: 'security_alert'
  readonly actorId: EntityId
  readonly target: string
  readonly severity: 'critical'
}

export interface AuditRecordEvent {
  readonly type: 'audit'
  readonly correlationId: string
  readonly severity: 'warning'
}

export type DomainEvent = InfoMetricEvent | SecurityAlertEvent | AuditRecordEvent

export type ExtractBySeverity<E extends DomainEvent, S extends Severity> = E extends { readonly severity: S } ? E
  : never

export type RemappedEventHandlers<T> = {
  readonly [K in keyof T as `handle${Capitalize<string & K>}`]: (payload: T[K]) => boolean
}
