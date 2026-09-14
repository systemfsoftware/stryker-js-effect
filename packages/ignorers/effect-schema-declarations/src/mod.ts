import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'

import { decideSchemaDeclarationIgnore } from './SchemaDeclarationIgnore.js'

export const strykerIgnorers: readonly Ignorer[] = [
  { name: 'effect-schema-declarations', shouldIgnore: decideSchemaDeclarationIgnore },
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
