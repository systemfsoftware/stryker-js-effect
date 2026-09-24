import type * as Oxc from '@oxc-project/types'

type Simplify<T> = { [K in keyof T]: T[K] } & {}

type Built<T> = T extends null | undefined ? T
  : T extends readonly unknown[] ? (number extends T['length'] ? Array<Built<T[number]>> : T)
  : T extends Oxc.Span ?
      & {
        [K in keyof T as K extends keyof Oxc.Span ? never : K]: Child<T[K]>
      }
      & Partial<Pick<T, keyof Oxc.Span>>
  : T

type Child<T> = T extends null | undefined ? T
  : T extends readonly unknown[] ? (number extends T['length'] ? Array<Child<T[number]>> : T)
  : T extends Oxc.Span ? Built<T> | T
  : T

export type Span = Oxc.Span

export type Program = Simplify<Built<Oxc.Program>>
export type Expression = Simplify<Built<Oxc.Expression>> | Oxc.Expression
export type Statement = Simplify<Built<Oxc.Statement>> | Oxc.Statement
export type Node = Simplify<Built<Oxc.Node>> | Oxc.Node

export type AccessorProperty = Simplify<Built<Oxc.AccessorProperty>>
export type Argument = Simplify<Built<Oxc.Argument>>
export type ArrayExpression = Simplify<Built<Oxc.ArrayExpression>>
export type ArrayPattern = Simplify<Built<Oxc.ArrayPattern>>
export type ArrowFunctionExpression = Simplify<Built<Oxc.ArrowFunctionExpression>>
export type AssignmentExpression = Simplify<Built<Oxc.AssignmentExpression>>
export type AssignmentPattern = Simplify<Built<Oxc.AssignmentPattern>>
export type BigIntLiteral = Simplify<Built<Oxc.BigIntLiteral>>
export type BinaryExpression = Simplify<Built<Oxc.BinaryExpression>>
export type BindingIdentifier = Simplify<Built<Oxc.BindingIdentifier>>
export type BindingPattern = Simplify<Built<Oxc.BindingPattern>>
export type BindingProperty = Simplify<Built<Oxc.BindingProperty>>
export type BindingRestElement = Simplify<Built<Oxc.BindingRestElement>>
export type BlockStatement = Simplify<Built<Oxc.BlockStatement>>
export type BooleanLiteral = Simplify<Built<Oxc.BooleanLiteral>>
export type BreakStatement = Simplify<Built<Oxc.BreakStatement>>
export type CallExpression = Simplify<Built<Oxc.CallExpression>>
export type CatchClause = Simplify<Built<Oxc.CatchClause>>
export type ChainExpression = Simplify<Built<Oxc.ChainExpression>>
export type Class = Simplify<Built<Oxc.Class>>
export type ClassBody = Simplify<Built<Oxc.ClassBody>>
export type ConditionalExpression = Simplify<Built<Oxc.ConditionalExpression>>
export type ContinueStatement = Simplify<Built<Oxc.ContinueStatement>>
export type Decorator = Simplify<Built<Oxc.Decorator>>
export type DoWhileStatement = Simplify<Built<Oxc.DoWhileStatement>>
export type EmptyStatement = Simplify<Built<Oxc.EmptyStatement>>
export type ExportAllDeclaration = Simplify<Built<Oxc.ExportAllDeclaration>>
export type ExportDefaultDeclaration = Simplify<Built<Oxc.ExportDefaultDeclaration>>
export type ExportNamedDeclaration = Simplify<Built<Oxc.ExportNamedDeclaration>>
export type ExpressionStatement = Simplify<Built<Oxc.ExpressionStatement>>
export type ForInStatement = Simplify<Built<Oxc.ForInStatement>>
export type ForOfStatement = Simplify<Built<Oxc.ForOfStatement>>
export type ForStatement = Simplify<Built<Oxc.ForStatement>>
export type Function = Simplify<Built<Oxc.Function>>
export type IdentifierName = Simplify<Built<Oxc.IdentifierName>>
export type IdentifierReference = Simplify<Built<Oxc.IdentifierReference>>
export type IfStatement = Simplify<Built<Oxc.IfStatement>>
export type ImportAttribute = Simplify<Built<Oxc.ImportAttribute>>
export type ImportDeclaration = Simplify<Built<Oxc.ImportDeclaration>>
export type ImportExpression = Simplify<Built<Oxc.ImportExpression>>
export type JSDocNonNullableType = Simplify<Built<Oxc.JSDocNonNullableType>>
export type JSDocNullableType = Simplify<Built<Oxc.JSDocNullableType>>
export type JSXAttribute = Simplify<Built<Oxc.JSXAttribute>>
export type JSXElement = Simplify<Built<Oxc.JSXElement>>
export type JSXExpressionContainer = Simplify<Built<Oxc.JSXExpressionContainer>>
export type JSXFragment = Simplify<Built<Oxc.JSXFragment>>
export type JSXIdentifier = Simplify<Built<Oxc.JSXIdentifier>>
export type JSXMemberExpression = Simplify<Built<Oxc.JSXMemberExpression>>
export type JSXNamespacedName = Simplify<Built<Oxc.JSXNamespacedName>>
export type JSXOpeningElement = Simplify<Built<Oxc.JSXOpeningElement>>
export type JSXSpreadAttribute = Simplify<Built<Oxc.JSXSpreadAttribute>>
export type JSXSpreadChild = Simplify<Built<Oxc.JSXSpreadChild>>
export type JSXText = Simplify<Built<Oxc.JSXText>>
export type LabelIdentifier = Simplify<Built<Oxc.LabelIdentifier>>
export type LabeledStatement = Simplify<Built<Oxc.LabeledStatement>>
export type LogicalExpression = Simplify<Built<Oxc.LogicalExpression>>
export type MemberExpression = Simplify<Built<Oxc.MemberExpression>>
export type MetaProperty = Simplify<Built<Oxc.MetaProperty>>
export type MethodDefinition = Simplify<Built<Oxc.MethodDefinition>>
export type NewExpression = Simplify<Built<Oxc.NewExpression>>
export type NullLiteral = Simplify<Built<Oxc.NullLiteral>>
export type NumericLiteral = Simplify<Built<Oxc.NumericLiteral>>
export type ObjectExpression = Simplify<Built<Oxc.ObjectExpression>>
export type ObjectProperty = Simplify<Built<Oxc.ObjectProperty>>
export type ParamPattern = Simplify<Built<Oxc.ParamPattern>>
export type PrivateIdentifier = Simplify<Built<Oxc.PrivateIdentifier>>
export type PrivateInExpression = Simplify<Built<Oxc.PrivateInExpression>>
export type PropertyDefinition = Simplify<Built<Oxc.PropertyDefinition>>
export type RegExpLiteral = Simplify<Built<Oxc.RegExpLiteral>>
export type ReturnStatement = Simplify<Built<Oxc.ReturnStatement>>
export type SequenceExpression = Simplify<Built<Oxc.SequenceExpression>>
export type SimpleAssignmentTarget = Simplify<Built<Oxc.SimpleAssignmentTarget>> | Oxc.SimpleAssignmentTarget
export type SpreadElement = Simplify<Built<Oxc.SpreadElement>>
export type StaticBlock = Simplify<Built<Oxc.StaticBlock>>
export type StaticMemberExpression = Simplify<Built<Oxc.StaticMemberExpression>>
export type StringLiteral = Simplify<Built<Oxc.StringLiteral>>
export type Super = Simplify<Built<Oxc.Super>>
export type SwitchCase = Simplify<Built<Oxc.SwitchCase>>
export type SwitchStatement = Simplify<Built<Oxc.SwitchStatement>>
export type TaggedTemplateExpression = Simplify<Built<Oxc.TaggedTemplateExpression>>
export type TemplateElement = Simplify<Built<Oxc.TemplateElement>>
export type TemplateLiteral = Simplify<Built<Oxc.TemplateLiteral>>
export type ThisExpression = Simplify<Built<Oxc.ThisExpression>>
export type ThrowStatement = Simplify<Built<Oxc.ThrowStatement>>
export type TryStatement = Simplify<Built<Oxc.TryStatement>>
export type TSArrayType = Simplify<Built<Oxc.TSArrayType>>
export type TSAsExpression = Simplify<Built<Oxc.TSAsExpression>>
export type TSCallSignatureDeclaration = Simplify<Built<Oxc.TSCallSignatureDeclaration>>
export type TSConditionalType = Simplify<Built<Oxc.TSConditionalType>>
export type TSConstructorType = Simplify<Built<Oxc.TSConstructorType>>
export type TSConstructSignatureDeclaration = Simplify<Built<Oxc.TSConstructSignatureDeclaration>>
export type TSEnumDeclaration = Simplify<Built<Oxc.TSEnumDeclaration>>
export type TSExportAssignment = Simplify<Built<Oxc.TSExportAssignment>>
export type TSFunctionType = Simplify<Built<Oxc.TSFunctionType>>
export type TSImportEqualsDeclaration = Simplify<Built<Oxc.TSImportEqualsDeclaration>>
export type TSImportType = Simplify<Built<Oxc.TSImportType>>
export type TSIndexedAccessType = Simplify<Built<Oxc.TSIndexedAccessType>>
export type TSIndexSignature = Simplify<Built<Oxc.TSIndexSignature>>
export type TSInferType = Simplify<Built<Oxc.TSInferType>>
export type TSInstantiationExpression = Simplify<Built<Oxc.TSInstantiationExpression>>
export type TSInterfaceBody = Simplify<Built<Oxc.TSInterfaceBody>>
export type TSInterfaceDeclaration = Simplify<Built<Oxc.TSInterfaceDeclaration>>
export type TSIntersectionType = Simplify<Built<Oxc.TSIntersectionType>>
export type TSLiteralType = Simplify<Built<Oxc.TSLiteralType>>
export type TSMappedType = Simplify<Built<Oxc.TSMappedType>>
export type TSMethodSignature = Simplify<Built<Oxc.TSMethodSignature>>
export type TSModuleBlock = Simplify<Built<Oxc.TSModuleBlock>>
export type TSModuleDeclaration = Simplify<Built<Oxc.TSModuleDeclaration>>
export type TSNamedTupleMember = Simplify<Built<Oxc.TSNamedTupleMember>>
export type TSNamespaceExportDeclaration = Simplify<Built<Oxc.TSNamespaceExportDeclaration>>
export type TSNonNullExpression = Simplify<Built<Oxc.TSNonNullExpression>>
export type TSOptionalType = Simplify<Built<Oxc.TSOptionalType>>
export type TSParenthesizedType = Simplify<Built<Oxc.TSParenthesizedType>>
export type TSPropertySignature = Simplify<Built<Oxc.TSPropertySignature>>
export type TSQualifiedName = Simplify<Built<Oxc.TSQualifiedName>>
export type TSRestType = Simplify<Built<Oxc.TSRestType>>
export type TSSatisfiesExpression = Simplify<Built<Oxc.TSSatisfiesExpression>>
export type TSTemplateLiteralType = Simplify<Built<Oxc.TSTemplateLiteralType>>
export type TSTupleType = Simplify<Built<Oxc.TSTupleType>>
export type TSType = Simplify<Built<Oxc.TSType>>
export type TSTypeAliasDeclaration = Simplify<Built<Oxc.TSTypeAliasDeclaration>>
export type TSTypeAnnotation = Simplify<Built<Oxc.TSTypeAnnotation>>
export type TSTypeAssertion = Simplify<Built<Oxc.TSTypeAssertion>>
export type TSTypeOperator = Simplify<Built<Oxc.TSTypeOperator>>
export type TSTypeParameterDeclaration = Simplify<Built<Oxc.TSTypeParameterDeclaration>>
export type TSTypeParameterInstantiation = Simplify<Built<Oxc.TSTypeParameterInstantiation>>
export type TSTypePredicate = Simplify<Built<Oxc.TSTypePredicate>>
export type TSTypeQuery = Simplify<Built<Oxc.TSTypeQuery>>
export type TSTypeReference = Simplify<Built<Oxc.TSTypeReference>>
export type TSUnionType = Simplify<Built<Oxc.TSUnionType>>
export type UnaryExpression = Simplify<Built<Oxc.UnaryExpression>>
export type UpdateExpression = Simplify<Built<Oxc.UpdateExpression>>
export type VariableDeclaration = Simplify<Built<Oxc.VariableDeclaration>>
export type VariableDeclarator = Simplify<Built<Oxc.VariableDeclarator>>
export type WhileStatement = Simplify<Built<Oxc.WhileStatement>>
export type WithStatement = Simplify<Built<Oxc.WithStatement>>
export type YieldExpression = Simplify<Built<Oxc.YieldExpression>>

export type ClassExpression = Omit<Simplify<Built<Oxc.Class>>, 'type'> & { type: 'ClassExpression' }
export type FunctionExpression = Omit<Simplify<Built<Oxc.Function>>, 'type'> & { type: 'FunctionExpression' }
export type Literal = StringLiteral | NumericLiteral | BooleanLiteral | BigIntLiteral | RegExpLiteral | NullLiteral
