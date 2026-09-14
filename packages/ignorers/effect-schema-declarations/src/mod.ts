import { ancestorsOf, type NodePath } from '@systemfsoftware/stryker-ignorer-interface'

import { AstNode } from './AstNode.schema.js'
import { decideSchemaDeclarationIgnore } from './SchemaDeclarationIgnore.js'

const decisionAt = (chain: readonly unknown[], position: number): string | undefined =>
  decideSchemaDeclarationIgnore(chain[position], chain[position + 1], chain[position + 2], chain[position + 3])

const firstIgnoreReason = (path: NodePath): string | undefined => {
  const chain = [path.node, ...ancestorsOf(path)]
  return chain.reduce<string | undefined>((found, _, position) => found ?? decisionAt(chain, position), undefined)
}

export const strykerIgnorers = [
  { name: 'effect-schema-declarations', schema: AstNode, shouldIgnore: firstIgnoreReason },
]

export {
  ANNOTATION_OBJECT_IGNORED,
  ANNOTATION_TEXT_IGNORED,
  BRAND_NAME_IGNORED,
  CLASS_FIELDS_IGNORED,
  CLASS_ID_IGNORED,
  decideSchemaDeclarationIgnore,
  OPTIONAL_DEFAULT_IGNORED,
  SYMBOL_DESCRIPTION_IGNORED,
  TAGGED_FIELDS_IGNORED,
  TAGGED_TAG_IGNORED,
} from './SchemaDeclarationIgnore.js'
