import rawSchemaJson from '../schema/typescript-checker-options.json' with { type: 'json' }

import * as S from 'effect/Schema'

export const strykerPlugins: readonly { readonly kind: 'Checker'; readonly name: string }[] = [
  { kind: 'Checker', name: 'typescript' },
]

const rawSchema: unknown = rawSchemaJson
if (!S.is(S.Record(S.String, S.Unknown))(rawSchema)) {
  throw new Error('Invalid typescript-checker schema file')
}
export const strykerValidationSchema: Record<string, unknown> = rawSchema
