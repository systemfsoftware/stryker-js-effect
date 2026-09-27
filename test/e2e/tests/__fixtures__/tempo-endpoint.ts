import { Config } from 'effect'

export const DEFAULT_TEMPO_URL = 'http://127.0.0.1:3200'

export const tempoBaseUrl = Config.String('TEMPO_URL').pipe(
  Config.withDefault(DEFAULT_TEMPO_URL),
  Config.map((url) => url.replace(/\/+$/u, '')),
)
