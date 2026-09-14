import type { NodePath } from './AstNode.js'

export type { StandardSchemaV1, StandardTypedV1 } from '@standard-schema/spec'
export * from './AstNode.js'
export * from './StandardSchema.js'

export interface PlainIgnorer {
  readonly name: string
  shouldIgnore(path: NodePath): string | undefined
}
