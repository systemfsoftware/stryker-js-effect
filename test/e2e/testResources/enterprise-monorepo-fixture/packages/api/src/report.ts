import { roundCents } from '@core/pricing'
import type { FeatureConfig, Severity } from '@enterprise/core'
import { gateStatus } from '@enterprise/services'
import { type Handler, route } from './dispatch.js'

export interface IncidentRequest {
  readonly severity?: Severity
  readonly note?: string
  readonly config?: FeatureConfig
}

export const handle = (request: IncidentRequest): Handler | string => {
  if (request.severity === undefined) {
    return 'rejected: missing severity'
  }
  if (!request.config?.enabled) {
    return 'rejected: feature disabled'
  }
  const handler = route(request.severity)
  return `${handler.channel}:${request.note ?? 'none'}`
}

export const cap = (amount: number, ceiling: number): number => (amount > ceiling ? ceiling : roundCents(amount))

export const statusFor = (config: FeatureConfig | undefined): string => gateStatus(config)
