import rawSchemaJson from '../schema/typescript-checker-options.json' with { type: 'json' }

import * as S from 'effect/Schema'

export const strykerPlugins: readonly {
  readonly kind: 'Checker'
  readonly name: string
  readonly workerEntry: string
}[] = [
  { kind: 'Checker', name: 'typescript', workerEntry: new URL('./main.mjs', import.meta.url).href },
]

const rawSchema: unknown = rawSchemaJson
if (!S.is(S.Record(S.String, S.Unknown))(rawSchema)) {
  throw new Error('Invalid typescript-checker schema file')
}
export const strykerValidationSchema: Record<string, unknown> = rawSchema
