import type {
  ArrowFunctionExpression as OxcArrowFunctionExpression,
  BinaryExpression as OxcBinaryExpression,
  CallExpression as OxcCallExpression,
  Function as OxcFunction,
  IdentifierReference as OxcIdentifier,
  IfStatement as OxcIfStatement,
  ImportDeclaration as OxcImportDeclaration,
  ImportNamespaceSpecifier as OxcImportNamespaceSpecifier,
  ImportSpecifier as OxcImportSpecifier,
  MemberExpression as OxcMemberExpression,
  MetaProperty as OxcMetaProperty,
  ObjectExpression as OxcObjectExpression,
  ObjectProperty as OxcProperty,
  Program as OxcProgram,
  StringLiteral as OxcStringLiteral,
} from '@oxc-project/types'

export type Identifier = OxcIdentifier
export type StringLiteral = OxcStringLiteral
export type Property = OxcProperty
export type FunctionExpression = OxcFunction
export type ObjectExpression = OxcObjectExpression
export type ArrowFunctionExpression = OxcArrowFunctionExpression
export type MemberExpression = OxcMemberExpression
export type CallExpression = OxcCallExpression
export type MetaProperty = OxcMetaProperty
export type BinaryExpression = OxcBinaryExpression
export type IfStatement = OxcIfStatement
export type ImportSpecifier = OxcImportSpecifier
export type ImportNamespaceSpecifier = OxcImportNamespaceSpecifier
export type ImportDeclaration = OxcImportDeclaration
export type Program = OxcProgram

export interface UnknownNode {
  readonly type: string
}

export type AstNodeType =
  | Identifier
  | StringLiteral
  | ObjectExpression
  | Property
  | ArrowFunctionExpression
  | FunctionExpression
  | MemberExpression
  | CallExpression
  | MetaProperty
  | BinaryExpression
  | IfStatement
  | ImportSpecifier
  | ImportNamespaceSpecifier
  | ImportDeclaration
  | Program
  | UnknownNode

export interface NodePath {
  readonly node: unknown
  readonly parentPath?: NodePath | null | undefined
}
