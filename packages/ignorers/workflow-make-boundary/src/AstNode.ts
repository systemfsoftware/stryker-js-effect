import {
  ArrowFunctionExpression,
  CallExpression,
  FunctionExpression,
  Identifier,
  ImportDeclaration,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  isArrowFunctionExpression,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportNamespaceSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isProgram,
  isStringLiteral,
  MemberExpression,
  Program,
  type Schema,
  StringLiteral,
  suspend,
  union,
  UnknownNode,
} from '@systemfsoftware/stryker-ignorer-interface'

export {
  ArrowFunctionExpression,
  CallExpression,
  FunctionExpression,
  Identifier,
  ImportDeclaration,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  isArrowFunctionExpression,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportNamespaceSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isProgram,
  isStringLiteral,
  MemberExpression,
  Program,
  StringLiteral,
  UnknownNode,
}

export const isArrowFunction = isArrowFunctionExpression

export type AstNode =
  | Identifier
  | StringLiteral
  | ArrowFunctionExpression
  | FunctionExpression
  | MemberExpression
  | CallExpression
  | UnknownNode

export const AstNode: Schema<AstNode> = suspend(
  (): Schema<AstNode> =>
    union([
      Identifier,
      StringLiteral,
      ArrowFunctionExpression,
      FunctionExpression,
      MemberExpression,
      CallExpression,
      UnknownNode,
    ]),
  { maxDepth: 6 },
)
