export const REGISTRY_CONCURRENCY = 8
const QUERY_TIMEOUT_MS = 30_000

const ABBREVIATED = 'application/vnd.npm.install-v1+json'

export interface RegistrySnapshot {
  readonly status: 'published' | 'unpublished' | 'error'
  readonly latest: string
  readonly attested: boolean
}

export const queryRegistry = async (
  name: string,
  registry = 'https://registry.npmjs.org',
): Promise<RegistrySnapshot> => {
  const unqueryable: RegistrySnapshot = { status: 'error', latest: '?', attested: false }
  let body: unknown
  try {
    const response = await fetch(`${registry}/${encodeURIComponent(name)}`, {
      headers: { accept: ABBREVIATED },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    })
    if (response.status === 404) {
      await response.body?.cancel()
      return { status: 'unpublished', latest: '—', attested: false }
    }
    if (!response.ok) {
      await response.body?.cancel()
      return unqueryable
    }
    body = await response.json()
  } catch {
    return unqueryable
  }

  if (typeof body !== 'object' || body === null) return unqueryable
  const doc = body as Record<string, unknown>
  if (doc['error'] === 'Not found') return { status: 'unpublished', latest: '—', attested: false }

  const distTags = doc['dist-tags']
  if (typeof distTags !== 'object' || distTags === null) return unqueryable
  const latest = (distTags as Record<string, unknown>)['latest']
  if (typeof latest !== 'string') return unqueryable

  const versions = doc['versions'] as Record<string, { dist?: { attestations?: unknown } }> | undefined
  return { status: 'published', latest, attested: versions?.[latest]?.dist?.attestations != null }
}
