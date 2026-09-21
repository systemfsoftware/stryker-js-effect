export const AUDIT_LOG = ['boot', 'ready'] as const

export interface AuditPayload {
  readonly event: string
  readonly actor?: {
    readonly id?: string
    readonly role?: string
  }
}

export async function* streamAuditEvents(events: readonly AuditPayload[]): AsyncGenerator<string, void, unknown> {
  for (const item of events) {
    const { event, actor: { id = 'anonymous', role = 'guest' } = {} } = item
    yield `${event}:${id}:${role}`
  }
}

export async function collectAuditEvents(events: readonly AuditPayload[]): Promise<string[]> {
  const results: string[] = []
  for await (const line of streamAuditEvents(events)) {
    results.push(line)
  }
  return results
}
