import type { NodePath } from './AstNode.schema.js'

export type { StandardSchemaV1, StandardTypedV1 } from '@standard-schema/spec'
export * from './AstNode.schema.js'
export * from './StandardSchema.js'

export interface PlainIgnorer {
  readonly name: string
  shouldIgnore(path: NodePath): string | undefined
}
