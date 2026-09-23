interface RawRuntimeConfig {
  readonly timeoutMs?: number
  readonly retries?: number
}

const loadRuntimeConfig = async (): Promise<RawRuntimeConfig> => {
  await Promise.resolve()
  return { timeoutMs: 800, retries: 2 }
}

const loaded = await loadRuntimeConfig()

export const TIMEOUT_MS = loaded.timeoutMs ?? 500
export const RETRIES = loaded.retries ?? 1
