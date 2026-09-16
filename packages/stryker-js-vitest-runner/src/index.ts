import * as S from 'effect/Schema'

import { VitestRunnerOptionsSchema } from './Runner.schema.js'

export const strykerPlugins: readonly { readonly kind: 'TestRunner'; readonly name: string }[] = [
  { kind: 'TestRunner', name: 'vitest' },
]

/**
 * The `vitest` option section as a JSON Schema document, for Stryker's option
 * validation — derived from the declaration, never read from a file. It is built
 * here, at the entry that contributes it, because a document is a *use* of a
 * schema and the schema module exports only declarations.
 */
export const strykerValidationSchema: Record<string, unknown> = S.toJsonSchemaDocument(
  S.Struct({ vitest: S.optional(VitestRunnerOptionsSchema) }),
).schema
