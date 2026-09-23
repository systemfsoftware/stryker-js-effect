import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

const TRACES_SUFFIX = '/v1/traces'

const tracesUrlOf = (endpoint: string) =>
  Option.match(
    Option.liftPredicate(endpoint.replace(/\/+$/u, ''), (trimmed) => trimmed.endsWith(TRACES_SUFFIX)),
    {
      onSome: (trimmed) => trimmed,
      onNone: () => `${endpoint.replace(/\/+$/u, '')}${TRACES_SUFFIX}`,
    },
  )

export const TracesUrl = S.String.pipe(
  S.decodeTo(S.String, {
    decode: SchemaGetter.transform(tracesUrlOf),
    encode: SchemaGetter.passthrough(),
  }),
)

export const WorkerTelemetryConfig = S.Struct({
  enabled: S.Boolean,
  serviceName: S.String,
  endpoint: TracesUrl,
})

export type WorkerTelemetryConfig = typeof WorkerTelemetryConfig.Type