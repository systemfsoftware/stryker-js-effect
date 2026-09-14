import {
  array,
  ArrowFunctionExpression,
  Identifier,
  is,
  isArrowFunctionExpression,
  isIdentifier,
  isMemberExpression,
  isObjectExpression,
  isStringLiteral,
  literal,
  literals,
  MemberExpression,
  nonEmptyArray,
  ObjectExpression,
  type Schema,
  StringLiteral,
  struct,
  suspend,
  type TypeOf,
  union,
  unknown,
  UnknownNode,
} from '@systemfsoftware/stryker-ignorer-interface'

export {
  ArrowFunctionExpression,
  Identifier,
  isArrowFunctionExpression,
  isIdentifier,
  isMemberExpression,
  isObjectExpression,
  isStringLiteral,
  MemberExpression,
  ObjectExpression,
  StringLiteral,
  UnknownNode,
}

/**
 * Strict — unlike the interface's loose `CallExpression` — because the decision indexes
 * `arguments` to prove a position is a declaration slot.
 */
export interface CallExpression {
  readonly type: 'CallExpression'
  readonly callee: AstNode
  readonly arguments: ReadonlyArray<AstNode>
}

export type AstNode =
  | Identifier
  | StringLiteral
  | ObjectExpression
  | ArrowFunctionExpression
  | MemberExpression
  | CallExpression
  | UnknownNode

export const AstNode: Schema<AstNode> = suspend(
  (): Schema<AstNode> =>
    union([
      Identifier,
      StringLiteral,
      ObjectExpression,
      ArrowFunctionExpression,
      MemberExpression,
      CallExpression,
      UnknownNode,
    ]),
  { maxDepth: 6 },
)

export const CallExpression: Schema<CallExpression> = struct({
  type: literal('CallExpression'),
  callee: AstNode,
  arguments: array(AstNode),
})

export const DocumentationKey = literals(['identifier', 'description', 'title', 'documentation', 'examples'])

export const DocumentationProperty = struct({
  type: literal('Property'),
  computed: literal(false),
  key: union([
    struct({ type: literal('Identifier'), name: DocumentationKey }),
    struct({ type: literal('Literal'), value: DocumentationKey }),
  ]),
  value: unknown(),
})

export const DocumentationObject = struct({
  type: literal('ObjectExpression'),
  properties: nonEmptyArray(DocumentationProperty),
})

export const isCallExpression = (value: unknown): value is CallExpression => is(CallExpression, value)
export const isDocumentationProperty = (value: unknown): value is TypeOf<typeof DocumentationProperty> =>
  is(DocumentationProperty, value)
export const isDocumentationObject = (value: unknown): value is TypeOf<typeof DocumentationObject> =>
  is(DocumentationObject, value)
