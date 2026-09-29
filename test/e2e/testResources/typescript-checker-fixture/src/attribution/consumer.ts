import { PAYLOAD_KIND } from './bridge.js'
import type { PayloadKind } from './bridge.js'
import { KIND_PREFIX } from './prefix.js'

export const KIND: PayloadKind = 'payload'

export function describeKind(): string {
  return KIND_PREFIX + PAYLOAD_KIND
}
