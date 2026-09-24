import * as S from 'effect/Schema'

export const ResolveEnvironmentFixtureSchema = S.Struct({
  name: S.Union([S.Literals(['node', 'jsdom', 'happy-dom', 'edge-runtime']), S.String]),
  root: S.String,
})

export const PlanDefineFixtureSchema = S.Struct({
  define: S.Record(
    S.Union([
      S.Literals(['__APP_VERSION__', 'app.config.level', 'import.meta.env.VITE_FEATURE', 'import.meta.vitest']),
      S.String,
    ]),
    S.Json,
  ),
  env: S.Record(S.String, S.String),
})
