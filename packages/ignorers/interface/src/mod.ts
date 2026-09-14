import type { NodePath } from './AstNode.schema.js'
import { declared, literal, string, struct } from './StandardSchema.js'
import type { StandardSchemaV1 } from './StandardSchemaV1.js'

export * from './AstNode.schema.js'
export * from './StandardSchema.js'
export type { StandardSchemaV1, StandardTypedV1 } from './StandardSchemaV1.js'

export interface PlainIgnorer {
  readonly name: string
  readonly schema: StandardSchemaV1
  shouldIgnore(path: NodePath): string | undefined
}

const isFunction = (value: unknown): value is (...args: ReadonlyArray<unknown>) => unknown =>
  typeof value === 'function'

const isShouldIgnore = (value: unknown): value is (path: NodePath) => string | undefined => typeof value === 'function'

export const PlainIgnorerSchema = struct({
  name: string(),
  schema: struct({
    '~standard': struct({
      version: literal(1),
      vendor: string(),
      validate: declared(isFunction),
    }),
  }),
  shouldIgnore: declared(isShouldIgnore),
})
