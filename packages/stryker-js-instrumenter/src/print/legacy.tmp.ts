import { dual } from 'effect/Function'
import { isNodeArg } from '../Ast.handle.js'
import type {
  AccessorProperty,
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  BindingIdentifier,
  BindingPattern,
  BlockStatement,
  CallExpression,
  CatchClause,
  Class,
  ClassBody,
  ConditionalExpression,
  Decorator,
  DoWhileStatement,
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Expression,
  ExpressionStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Function as FunctionNode,
  IfStatement,
  ImportAttribute,
  ImportDeclaration,
  ImportExpression,
  JSDocNonNullableType,
  JSDocNullableType,
  JSXAttribute,
  JSXElement,
  JSXFragment,
  JSXMemberExpression,
  JSXOpeningElement,
  LabeledStatement,
  LabelIdentifier,
  Literal,
  LogicalExpression,
  MemberExpression,
  MetaProperty,
  MethodDefinition,
  NewExpression,
  Node,
  ObjectExpression,
  ParamPattern,
  Program,
  PropertyDefinition,
  ReturnStatement,
  SequenceExpression,
  Statement,
  StaticBlock,
  StringLiteral,
  SwitchCase,
  SwitchStatement,
  TaggedTemplateExpression,
  TemplateElement,
  TemplateLiteral,
  TryStatement,
  TSAsExpression,
  TSCallSignatureDeclaration,
  TSConstructorType,
  TSConstructSignatureDeclaration,
  TSEnumDeclaration,
  TSFunctionType,
  TSImportEqualsDeclaration,
  TSImportType,
  TSIndexSignature,
  TSInstantiationExpression,
  TSInterfaceBody,
  TSInterfaceDeclaration,
  TSLiteralType,
  TSMappedType,
  TSMethodSignature,
  TSNamedTupleMember,
  TSPropertySignature,
  TSSatisfiesExpression,
  TSTemplateLiteralType,
  TSTupleType,
  TSType,
  TSTypeAliasDeclaration,
  TSTypeAnnotation,
  TSTypeAssertion,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
  TSTypePredicate,
  TSTypeQuery,
  TSTypeReference,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  VariableDeclarator,
  WhileStatement,
  WithStatement,
  YieldExpression,
} from '@systemfsoftware/stryker-ignorer-interface'

export interface Comment {
  readonly type: 'Line' | 'Block'
  readonly value: string
  readonly start: number
  readonly end: number
}

export interface Hashbang {
  readonly type: 'Hashbang'
  readonly value: string
  readonly start: number
}

export interface PrintOptions {
  readonly comments?: readonly Comment[]
  readonly hashbang?: Hashbang | null
}

export interface PrintProgramOptions extends PrintOptions {}

export const printProgram: {
  (program: Program, opts?: PrintProgramOptions): string
  (opts?: PrintProgramOptions): (program: Program) => string
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isNodeArg(args[0]),
  (program: Program, opts: PrintProgramOptions = {}): string => renderProgram(createState(opts), program),
)

export const printNode: {
  (node: Node, opts?: PrintOptions): string
  (opts?: PrintOptions): (node: Node) => string
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isNodeArg(args[0]),
  (node: Node, opts: PrintOptions = {}): string => renderAnyNode(createState(opts), node),
)

const PREC = {
  Sequence: 0,
  Assignment: 1,
  Conditional: 2,
  NullishCoalescing: 3,
  LogicalOR: 4,
  LogicalAND: 5,
  BitwiseOR: 6,
  BitwiseXOR: 7,
  BitwiseAND: 8,
  Equality: 9,
  Relational: 10,
  Shift: 11,
  Additive: 12,
  Multiplicative: 13,
  Exponential: 14,
  Unary: 15,
  Update: 16,
  Call: 17,
  Member: 18,
  Primary: 19,
}

function binaryPrec(op: string): number {
  switch (op) {
    case '||':
      return PREC.LogicalOR
    case '&&':
      return PREC.LogicalAND
    case '??':
      return PREC.NullishCoalescing
    case '|':
      return PREC.BitwiseOR
    case '^':
      return PREC.BitwiseXOR
    case '&':
      return PREC.BitwiseAND
    case '==':
    case '!=':
    case '===':
    case '!==':
      return PREC.Equality
    case '<':
    case '>':
    case '<=':
    case '>=':
    case 'in':
    case 'instanceof':
      return PREC.Relational
    case '<<':
    case '>>':
    case '>>>':
      return PREC.Shift
    case '+':
    case '-':
      return PREC.Additive
    case '*':
    case '/':
    case '%':
      return PREC.Multiplicative
    case '**':
      return PREC.Exponential
    default:
      return PREC.Additive
  }
}

const LOGICAL_PRECEDENCE: Readonly<Record<string, number>> = {
  '??': PREC.NullishCoalescing,
  '||': PREC.LogicalOR,
  '&&': PREC.LogicalAND,
}

function logicalPrec(op: string): number {
  return LOGICAL_PRECEDENCE[op] ?? PREC.LogicalAND
}

interface PrintState {
  out: string
  indentLevel: number
  readonly hashbang: Hashbang | null
  commentIdx: number
  readonly sortedComments: readonly Comment[]
}

function createState(opts: PrintOptions): PrintState {
  const hashbang = opts.hashbang ?? null
  return {
    out: '',
    indentLevel: 0,
    hashbang,
    commentIdx: 0,
    sortedComments: [...sortedCommentsWithoutHashbang(opts.comments, hashbang), END_OF_COMMENTS],
  }
}

function renderProgram(state: PrintState, program: Program): string {
  state.out = ''
  state.indentLevel = 0
  state.commentIdx = 0

  printHashbang(state)

  emitCommentsBefore(state, program.body[0]?.start)
  printProgramBody(state, program.body)

  emitCommentsBefore(state, undefined)

  return state.out
}

function renderAnyNode(state: PrintState, node: Node): string {
  state.out = ''
  state.indentLevel = 0
  printNodePrec(state, node, PREC.Sequence)
  return state.out
}

function printHashbang(state: PrintState): void {
  if (state.hashbang !== null) state.out += `#!${state.hashbang.value}\n`
}

function printProgramBody(state: PrintState, body: Program['body']): void {
  body.forEach((statement) => printProgramStatement(state, statement))
}

function printProgramStatement(state: PrintState, statement: Program['body'][number]): void {
  emitCommentsBefore(state, statement.start ?? -1)
  printStatement(state, statement)
  state.out += '\n'
}

function printJumpStatement(state: PrintState, keyword: string, label: LabelIdentifier | null): void {
  state.out += keyword
  if (label !== null) state.out += ` ${label.name}`
  state.out += ';'
}

function emitCommentsBefore(state: PrintState, pos: number | undefined): void {
  emitPendingCommentsBefore(state, pos ?? EVERY_COMMENT_POSITION)
}

function emitPendingCommentsBefore(state: PrintState, pos: number): void {
  let comment = state.sortedComments[state.commentIdx]
  while (isCommentBefore(comment, pos)) {
    emitComment(state, comment)
    state.commentIdx++
    comment = state.sortedComments[state.commentIdx]
  }
}

function isCommentBefore(comment: Comment | undefined, pos: number): comment is Comment {
  return comment !== undefined && comment.start < pos
}

function emitComment(state: PrintState, c: Comment): void {
  if (c.type === 'Line') {
    state.out += `//${c.value}\n`
  } else {
    state.out += `/*${c.value}*/\n`
  }
}

function indent(state: PrintState): string {
  return '  '.repeat(state.indentLevel)
}

function capture(state: PrintState, render: () => void): string {
  const saved = state.out
  state.out = ''
  render()
  const result = state.out
  state.out = saved
  return result
}

function needsParens(childPrec: number, parentPrec: number, isRight: boolean, op?: string): boolean {
  if (childPrec === parentPrec) return equalPrecedenceNeedsParens(isRight, op)
  return childPrec < parentPrec
}

function equalPrecedenceNeedsParens(isRight: boolean, op?: string): boolean {
  if (op === '**') return !isRight
  return isRight
}

function wrapIfNeeded(
  state: PrintState,
  node: Node,
  prec: number,
  parentPrec: number,
  isRight: boolean,
  op?: string,
): string {
  const inner = printExpressionToString(state, node, prec)
  if (needsParens(prec, parentPrec, isRight, op)) return `(${inner})`
  return inner
}

function printExpressionToString(state: PrintState, node: Node, prec: number): string {
  return capture(state, () => printNodePrec(state, node, prec))
}

function sequenceNodeText(state: PrintState, node: Node | null | undefined): string {
  return capture(state, () => printNodePrec(state, node, PREC.Sequence))
}

function assignmentNodeText(state: PrintState, node: Node | null | undefined): string {
  return capture(state, () => printNodePrec(state, node, PREC.Assignment))
}

function nodeListText(state: PrintState, nodes: readonly Node[], prec: number): string {
  return nodes.map((node) => capture(state, () => printNodePrec(state, node, prec))).join(', ')
}

function wrappedExpressionText(
  state: PrintState,
  node: Node,
  prec: number,
  wrappedKinds: Readonly<Record<string, true>>,
): string {
  const printed = printExpressionToString(state, node, prec)
  if (wrappedKinds[node.type] === true) return `(${printed})`
  return printed
}

function printNodePrec(state: PrintState, node: Node | null | undefined, prec: number): void {
  if (node == null) return
  dispatchNode(state, node, prec)
}

function dispatchNode(state: PrintState, node: Node, prec: number): void {
  switch (node.type) {
    case 'Literal':
      printLiteral(state, node)
      break
    case 'Identifier':
      printIdentifier(state, node)
      break
    case 'PrivateIdentifier':
      state.out += `#${node.name}`
      break
    case 'ThisExpression':
      state.out += 'this'
      break
    case 'Super':
      state.out += 'super'
      break
    case 'ArrayExpression':
      printArrayExpression(state, node)
      break
    case 'ObjectExpression':
      printObjectExpression(state, node)
      break
    case 'Property':
      printProperty(state, node)
      break
    case 'TemplateLiteral':
      printTemplateLiteral(state, node)
      break
    case 'TemplateElement':
      state.out += node.value.raw
      break
    case 'TaggedTemplateExpression':
      printTaggedTemplate(state, node)
      break
    case 'MemberExpression':
      printMemberExpression(state, node, prec)
      break
    case 'CallExpression':
      printCallExpression(state, node, prec)
      break
    case 'NewExpression':
      printNewExpression(state, node, prec)
      break
    case 'MetaProperty':
      printMetaProperty(state, node)
      break
    case 'SpreadElement':
      state.out += '...'
      printNodePrec(state, node.argument, PREC.Assignment)
      break
    case 'RestElement':
      state.out += '...'
      printNodePrec(state, node.argument, PREC.Assignment)
      break
    case 'UpdateExpression':
      printUpdateExpression(state, node, prec)
      break
    case 'UnaryExpression':
      printUnaryExpression(state, node, prec)
      break
    case 'BinaryExpression':
      printBinaryExpression(state, node, prec)
      break
    case 'LogicalExpression':
      printLogicalExpression(state, node, prec)
      break
    case 'ConditionalExpression':
      printConditionalExpression(state, node, prec)
      break
    case 'AssignmentExpression':
      printAssignmentExpression(state, node, prec)
      break
    case 'AssignmentPattern':
      printAssignmentPattern(state, node, prec)
      break
    case 'ObjectPattern':
      printObjectPattern(state, node)
      break
    case 'ArrayPattern':
      printArrayPattern(state, node)
      break
    case 'SequenceExpression':
      printSequenceExpression(state, node, prec)
      break
    case 'AwaitExpression':
      state.out += 'await '
      printNodePrec(state, node.argument, PREC.Unary)
      break
    case 'YieldExpression':
      printYieldExpression(state, node, prec)
      break
    case 'ChainExpression':
      printNodePrec(state, node.expression, prec)
      break
    case 'ParenthesizedExpression':
      state.out += '('
      printNodePrec(state, node.expression, PREC.Sequence)
      state.out += ')'
      break
    case 'ImportExpression':
      printImportExpression(state, node)
      break
    case 'V8IntrinsicExpression':
      printV8Intrinsic(state, node)
      break
    case 'ArrowFunctionExpression':
      printArrowFunction(state, node, prec)
      break
    case 'FunctionExpression':
    case 'FunctionDeclaration':
    case 'TSDeclareFunction':
    case 'TSEmptyBodyFunctionExpression':
      printFunction(state, node, prec)
      break
    case 'ClassDeclaration':
    case 'ClassExpression':
      printClass(state, node, prec)
      break
    case 'JSXElement':
      printJSXElement(state, node)
      break
    case 'JSXFragment':
      printJSXFragment(state, node)
      break
    case 'JSXOpeningElement':
      printJSXOpeningElement(state, node)
      break
    case 'JSXClosingElement':
      break
    case 'JSXIdentifier':
      state.out += node.name
      break
    case 'JSXNamespacedName':
      state.out += `${node.namespace.name}:${node.name.name}`
      break
    case 'JSXMemberExpression':
      printJSXMemberExpression(state, node)
      break
    case 'JSXAttribute':
      printJSXAttribute(state, node)
      break
    case 'JSXSpreadAttribute':
      state.out += '{...'
      printNodePrec(state, node.argument, PREC.Assignment)
      state.out += '}'
      break
    case 'JSXExpressionContainer':
      state.out += '{'
      printNodePrec(state, node.expression, PREC.Sequence)
      state.out += '}'
      break
    case 'JSXEmptyExpression':
      break
    case 'JSXText':
      state.out += node.value
      break
    case 'JSXSpreadChild':
      state.out += '{...'
      printNodePrec(state, node.expression, PREC.Assignment)
      state.out += '}'
      break
    case 'TSAsExpression':
      printTSAsExpression(state, node, prec)
      break
    case 'TSSatisfiesExpression':
      printTSSatisfiesExpression(state, node, prec)
      break
    case 'TSTypeAssertion':
      printTSTypeAssertion(state, node, prec)
      break
    case 'TSNonNullExpression':
      printNodePrec(state, node.expression, PREC.Member)
      state.out += '!'
      break
    case 'TSInstantiationExpression':
      printTSInstantiationExpression(state, node, prec)
      break
    case 'BlockStatement':
      printBlockStatement(state, node)
      break
    case 'EmptyStatement':
      state.out += ';'
      break
    case 'ExpressionStatement':
      printExpressionStatement(state, node)
      break
    case 'IfStatement':
      printIfStatement(state, node)
      break
    case 'DoWhileStatement':
      printDoWhileStatement(state, node)
      break
    case 'WhileStatement':
      printWhileStatement(state, node)
      break
    case 'ForStatement':
      printForStatement(state, node)
      break
    case 'ForInStatement':
      printForInStatement(state, node)
      break
    case 'ForOfStatement':
      printForOfStatement(state, node)
      break
    case 'ContinueStatement':
      printJumpStatement(state, 'continue', node.label)
      break
    case 'BreakStatement':
      printJumpStatement(state, 'break', node.label)
      break
    case 'ReturnStatement':
      printReturnStatement(state, node)
      break
    case 'WithStatement':
      printWithStatement(state, node)
      break
    case 'SwitchStatement':
      printSwitchStatement(state, node)
      break
    case 'SwitchCase':
      break
    case 'LabeledStatement':
      printLabeledStatement(state, node)
      break
    case 'ThrowStatement':
      state.out += 'throw '
      printNodePrec(state, node.argument, PREC.Sequence)
      state.out += ';'
      break
    case 'TryStatement':
      printTryStatement(state, node)
      break
    case 'CatchClause':
      break
    case 'DebuggerStatement':
      state.out += 'debugger;'
      break
    case 'VariableDeclaration':
      printVariableDeclaration(state, node)
      break
    case 'VariableDeclarator':
      printVariableDeclarator(state, node)
      break
    case 'ClassBody':
      printClassBody(state, node)
      break
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
      printMethodDefinition(state, node)
      break
    case 'PropertyDefinition':
    case 'TSAbstractPropertyDefinition':
      printPropertyDefinition(state, node)
      break
    case 'AccessorProperty':
    case 'TSAbstractAccessorProperty':
      printAccessorProperty(state, node)
      break
    case 'StaticBlock':
      printStaticBlock(state, node)
      break
    case 'ImportDeclaration':
      printImportDeclaration(state, node)
      break
    case 'ExportNamedDeclaration':
      printExportNamedDeclaration(state, node)
      break
    case 'ExportDefaultDeclaration':
      printExportDefaultDeclaration(state, node)
      break
    case 'ExportAllDeclaration':
      printExportAllDeclaration(state, node)
      break
    case 'Decorator':
      state.out += '@'
      printNodePrec(state, node.expression, PREC.Member)
      break
    case 'TSTypeAliasDeclaration':
      printTSTypeAliasDeclaration(state, node)
      break
    case 'TSInterfaceDeclaration':
      printTSInterfaceDeclaration(state, node)
      break
    case 'TSEnumDeclaration':
      printTSEnumDeclaration(state, node)
      break
    case 'TSModuleDeclaration':
      printTSModuleDeclaration(state, node)
      break
    case 'TSImportEqualsDeclaration':
      printTSImportEqualsDeclaration(state, node)
      break
    case 'TSExportAssignment':
      state.out += `export = `
      printNodePrec(state, node.expression, PREC.Sequence)
      state.out += ';'
      break
    case 'TSNamespaceExportDeclaration':
      state.out += `export as namespace ${node.id.name};`
      break
    case 'Program':
    case 'ExportSpecifier':
    case 'Hashbang':
    case 'ImportAttribute':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ImportSpecifier':
    case 'JSXClosingFragment':
    case 'JSXOpeningFragment':
    case 'TSAnyKeyword':
    case 'TSArrayType':
    case 'TSBigIntKeyword':
    case 'TSBooleanKeyword':
    case 'TSCallSignatureDeclaration':
    case 'TSClassImplements':
    case 'TSConditionalType':
    case 'TSConstructSignatureDeclaration':
    case 'TSConstructorType':
    case 'TSEnumBody':
    case 'TSEnumMember':
    case 'TSExternalModuleReference':
    case 'TSFunctionType':
    case 'TSImportType':
    case 'TSIndexSignature':
    case 'TSIndexedAccessType':
    case 'TSInferType':
    case 'TSInterfaceBody':
    case 'TSInterfaceHeritage':
    case 'TSIntersectionType':
    case 'TSIntrinsicKeyword':
    case 'TSJSDocNonNullableType':
    case 'TSJSDocNullableType':
    case 'TSJSDocUnknownType':
    case 'TSLiteralType':
    case 'TSMappedType':
    case 'TSMethodSignature':
    case 'TSModuleBlock':
    case 'TSNamedTupleMember':
    case 'TSNeverKeyword':
    case 'TSNullKeyword':
    case 'TSNumberKeyword':
    case 'TSObjectKeyword':
    case 'TSOptionalType':
    case 'TSParameterProperty':
    case 'TSParenthesizedType':
    case 'TSPropertySignature':
    case 'TSQualifiedName':
    case 'TSRestType':
    case 'TSStringKeyword':
    case 'TSSymbolKeyword':
    case 'TSTemplateLiteralType':
    case 'TSThisType':
    case 'TSTupleType':
    case 'TSTypeAnnotation':
    case 'TSTypeLiteral':
    case 'TSTypeOperator':
    case 'TSTypeParameter':
    case 'TSTypeParameterDeclaration':
    case 'TSTypeParameterInstantiation':
    case 'TSTypePredicate':
    case 'TSTypeQuery':
    case 'TSTypeReference':
    case 'TSUndefinedKeyword':
    case 'TSUnionType':
    case 'TSUnknownKeyword':
    case 'TSVoidKeyword':
      printUnclassifiedNode(state, node, node.type)
      break
  }
}

function printUnclassifiedNode(state: PrintState, node: Node, kind: string): void {
  if (isTSType(node)) {
    printTSType(state, node)
    return
  }
  printTypeHolderNode(state, node, kind)
}

function printTypeHolderNode(state: PrintState, node: Node, kind: string): void {
  switch (kind) {
    case 'TSTypeAnnotation':
      printTypeAnnotationHolder(state, node)
      break
    case 'TSTypeParameterDeclaration':
      printTypeParameterDeclarationHolder(state, node)
      break
    case 'TSTypeParameterInstantiation':
      printTypeParameterInstantiationHolder(state, node)
      break
    case 'TSTypeParameter':
      printTypeParameterHolder(state, node)
      break
    default:
      state.out += `/* unknown:${kind} */`
      break
  }
}

function printTypeAnnotationHolder(state: PrintState, node: Node): void {
  if (isNodeOfKind(node, 'TSTypeAnnotation')) {
    state.out += ': '
    printTSType(state, node.typeAnnotation)
  }
}

function printTypeParameterDeclarationHolder(state: PrintState, node: Node): void {
  if (isNodeOfKind(node, 'TSTypeParameterDeclaration')) printTSTypeParameterDeclaration(state, node)
}

function printTypeParameterInstantiationHolder(state: PrintState, node: Node): void {
  if (isNodeOfKind(node, 'TSTypeParameterInstantiation')) printTSTypeParameterInstantiation(state, node)
}

function printTypeParameterHolder(state: PrintState, node: Node): void {
  if (isNodeOfKind(node, 'TSTypeParameter')) printTSTypeParameter(state, node)
}

function printLiteral(state: PrintState, node: LiteralNode): void {
  state.out += literalText(node)
}

function printIdentifier(state: PrintState, node: { readonly name: string }): void {
  state.out += node.name
}

function printArrayExpression(state: PrintState, node: ArrayExpression): void {
  state.out += `[${node.elements.map((element) => arrayElementText(state, element)).join(', ')}]`
}

function arrayElementText(state: PrintState, element: Node | null): string {
  if (element === null) return ''
  return assignmentNodeText(state, element)
}

function printObjectExpression(state: PrintState, node: ObjectExpression): void {
  switch (node.properties.length) {
    case 0:
      state.out += '{}'
      break
    default:
      state.out += `{ ${nodeListText(state, node.properties, PREC.Sequence)} }`
  }
}

function printProperty(state: PrintState, node: PropertyLike): void {
  switch (propertyForm(node)) {
    case 'accessor':
      state.out += `${node.kind} `
      state.out += propertyKeyText(state, node.key, node.computed === true, PREC.Assignment)
      printFunctionValueTail(state, node.value)
      break
    case 'method':
      state.out += propertyKeyText(state, node.key, node.computed === true, PREC.Assignment)
      printFunctionValueTail(state, node.value)
      break
    case 'shorthand':
      state.out += identifierNameText(node.key)
      break
    case 'shorthandDefault':
      printShorthandDefaultProperty(state, node)
      break
    default:
      state.out += propertyKeyText(state, node.key, node.computed === true, PREC.Assignment)
      state.out += ': '
      printNodePrec(state, node.value, PREC.Assignment)
      break
  }
}

function printFunctionValueTail(state: PrintState, value: Node): void {
  if (isFunctionNode(value)) printFunctionTail(state, value)
}

function printShorthandDefaultProperty(state: PrintState, node: PropertyLike): void {
  if (!isAssignmentPattern(node.value)) return
  const right = assignmentNodeText(state, node.value.right)
  state.out += `${identifierNameText(node.key)} = ${right}`
}

function propertyKeyText(state: PrintState, key: Node, computed: boolean, computedPrec: number): string {
  if (computed) return `[${capture(state, () => printNodePrec(state, key, computedPrec))}]`
  return plainPropertyKeyText(state, key)
}

function plainPropertyKeyText(state: PrintState, key: Node): string {
  switch (nodeKind(key)) {
    case 'Identifier':
      return identifierNameText(key)
    case 'PrivateIdentifier':
      return privateIdentifierText(key)
    case 'Literal':
      return literalCapture(state, key)
    default:
      return capture(state, () => printNodePrec(state, key, PREC.Assignment))
  }
}

function printFunctionTail(state: PrintState, fn: FunctionNode): void {
  state.out += typeParametersText(state, fn.typeParameters)
  state.out += `(${paramsText(state, fn.params)})`
  state.out += typeAnnotationText(state, fn.returnType)
  state.out += functionBodyText(state, fn)
}

function functionBodyText(state: PrintState, fn: FunctionNode): string {
  const body = fn.body
  if (body !== null) return ` ${capture(state, () => printBlockStatement(state, body))}`
  return ';'
}

function paramsText(state: PrintState, params: readonly ParamPattern[]): string {
  return capture(state, () => printParams(state, params))
}

function typeParametersText(state: PrintState, params: TSTypeParameterDeclaration | null | undefined): string {
  if (params == null) return ''
  return capture(state, () => printTSTypeParameterDeclaration(state, params))
}

function typeArgumentsText(state: PrintState, args: TSTypeParameterInstantiation | null | undefined): string {
  if (args == null) return ''
  return capture(state, () => printTSTypeParameterInstantiation(state, args))
}

function typeAnnotationText(state: PrintState, annotation: TSTypeAnnotation | null | undefined): string {
  if (annotation == null) return ''
  return capture(state, () => printTSTypeAnnotation(state, annotation))
}

function printTemplateLiteral(state: PrintState, node: TemplateLiteral): void {
  state.out += `\`${
    node.quasis
      .map((quasi, index) => quasiText(state, quasi, node.expressions[index]))
      .join('')
  }\``
}

function quasiText(state: PrintState, quasi: TemplateElement, expression: Expression | undefined): string {
  if (quasi.tail) return quasi.value.raw
  return `${quasi.value.raw}\${${sequenceNodeText(state, expression)}}`
}

function printTaggedTemplate(state: PrintState, node: TaggedTemplateExpression): void {
  printNodePrec(state, node.tag, PREC.Member)
  if (node.typeArguments != null) printTSTypeParameterInstantiation(state, node.typeArguments)
  printTemplateLiteral(state, node.quasi)
}

function printMemberExpression(state: PrintState, node: MemberExpression, _prec: number): void {
  state.out += wrappedExpressionText(state, node.object, PREC.Member, MEMBER_OBJECT_WRAPPED_KINDS)
  state.out += flagText(node.optional, '?.')
  state.out += memberSelectorText(state, node)
}

function memberSelectorText(state: PrintState, access: MemberExpression): string {
  if (access.computed) return `[${sequenceNodeText(state, access.property)}]`
  return `${flagText(!access.optional, '.')}${memberPropertyText(state, access.property)}`
}

function memberPropertyText(state: PrintState, property: Node): string {
  switch (nodeKind(property)) {
    case 'Identifier':
      return identifierNameText(property)
    case 'PrivateIdentifier':
      return privateIdentifierText(property)
    default:
      return sequenceNodeText(state, property)
  }
}

function printCallExpression(state: PrintState, node: CallExpression, _prec: number): void {
  state.out += wrappedExpressionText(state, node.callee, PREC.Member, CALLEE_WRAPPED_KINDS)
  state.out += flagText(node.optional, '?.')
  state.out += typeArgumentsText(state, node.typeArguments)
  state.out += `(${nodeListText(state, node.arguments, PREC.Assignment)})`
}

function printNewExpression(state: PrintState, node: NewExpression, _prec: number): void {
  state.out += 'new '
  state.out += printExpressionToString(state, node.callee, PREC.Member)
  state.out += typeArgumentsText(state, node.typeArguments)
  state.out += `(${nodeListText(state, node.arguments, PREC.Assignment)})`
}

function printMetaProperty(state: PrintState, node: MetaProperty): void {
  state.out += `${node.meta.name}.${node.property.name}`
}

function printV8Intrinsic(
  state: PrintState,
  node: { readonly name: { readonly name: string }; readonly arguments: readonly Node[] },
): void {
  state.out += `%${node.name.name}(${nodeListText(state, node.arguments, PREC.Assignment)})`
}

function printImportExpression(state: PrintState, node: ImportExpression): void {
  state.out += `import${flagText(node.phase, `.${node.phase}`)}(`
  state.out += assignmentNodeText(state, node.source)
  state.out += flagText(node.options, `, ${assignmentNodeText(state, node.options)}`)
  state.out += ')'
}

function printUpdateExpression(state: PrintState, node: UpdateExpression, _prec: number): void {
  const operand = wrappedExpressionText(state, node.argument, PREC.Update, MEMBER_OBJECT_WRAPPED_KINDS)
  if (node.prefix) {
    state.out += `${node.operator}${operand}`
    return
  }
  state.out += `${operand}${node.operator}`
}

function printUnaryExpression(state: PrintState, node: UnaryExpression, _prec: number): void {
  state.out += node.operator
  state.out += flagText(UNARY_WORD_OPERATORS[node.operator] === true, ' ')
  state.out += wrappedExpressionText(state, node.argument, PREC.Unary, UNARY_OPERAND_WRAPPED_KINDS)
}

function printBinaryExpression(state: PrintState, node: BinaryLike, prec: number): void {
  const myPrec = binaryPrec(node.operator)
  const leftStr = wrapIfNeeded(state, node.left, precOf(node.left), myPrec, false, node.operator)
  const rightStr = wrapIfNeeded(state, node.right, precOf(node.right), myPrec, true, node.operator)
  const whole = `${leftStr} ${node.operator} ${rightStr}`
  if (myPrec < prec) {
    state.out += `(${whole})`
  } else {
    state.out += whole
  }
}

function printLogicalExpression(state: PrintState, node: LogicalExpression, prec: number): void {
  const myPrec = logicalPrec(node.operator)
  const leftStr = wrapIfNeeded(state, node.left, precOf(node.left), myPrec, false, node.operator)
  const rightStr = wrapIfNeeded(state, node.right, precOf(node.right), myPrec, true, node.operator)
  const whole = `${leftStr} ${node.operator} ${rightStr}`
  if (myPrec < prec) state.out += `(${whole})`
  else state.out += whole
}

function printConditionalExpression(state: PrintState, node: ConditionalExpression, prec: number): void {
  const myPrec = PREC.Conditional
  const testStr = wrapIfNeeded(state, node.test, precOf(node.test), myPrec, false)
  const consStr = printExpressionToString(state, node.consequent, PREC.Assignment)
  const altStr = printExpressionToString(state, node.alternate, PREC.Assignment)
  const whole = `${testStr} ? ${consStr} : ${altStr}`
  if (myPrec < prec) state.out += `(${whole})`
  else state.out += whole
}

function printAssignmentExpression(state: PrintState, node: AssignmentExpression, prec: number): void {
  const myPrec = PREC.Assignment
  const leftStr = printExpressionToString(state, node.left, myPrec)
  const rightStr = printExpressionToString(state, node.right, myPrec - 0.1)
  const whole = `${leftStr} ${node.operator} ${rightStr}`
  if (myPrec < prec) state.out += `(${whole})`
  else state.out += whole
}

function printAssignmentPattern(
  state: PrintState,
  node: Extract<Node, { type: 'AssignmentPattern' }>,
  prec: number,
): void {
  const leftText = printExpressionToString(state, node.left, PREC.Assignment) +
    typeAnnotationText(state, bindingTypeAnnotation(node.left))
  const rightText = printExpressionToString(state, node.right, PREC.Assignment)
  state.out += parenthesizedIf(PREC.Assignment < prec, `${leftText} = ${rightText}`)
}

function printObjectPattern(state: PrintState, node: { readonly properties: readonly Node[] }): void {
  switch (node.properties.length) {
    case 0:
      state.out += '{}'
      break
    default:
      state.out += `{ ${nodeListText(state, node.properties, PREC.Sequence)} }`
  }
}

function printArrayPattern(state: PrintState, node: Extract<Node, { type: 'ArrayPattern' }>): void {
  state.out += `[${node.elements.map((element) => arrayElementText(state, element)).join(', ')}]`
}

function printSequenceExpression(state: PrintState, node: SequenceExpression, prec: number): void {
  const whole = node.expressions
    .map((expression) => printExpressionToString(state, expression, PREC.Sequence))
    .join(', ')
  state.out += parenthesizedIf(PREC.Sequence < prec, whole)
}

function printYieldExpression(state: PrintState, node: YieldExpression, _prec: number): void {
  if (node.delegate) {
    state.out += 'yield*'
  } else {
    state.out += 'yield'
  }
  state.out += flagText(node.argument, ` ${assignmentNodeText(state, node.argument)}`)
}

function printArrowFunction(state: PrintState, node: ArrowFunctionExpression, prec: number): void {
  const arrow = `${flagText(node.async, 'async ')}${typeParametersText(state, node.typeParameters)}` +
    `${arrowParamsText(state, node)}${typeAnnotationText(state, node.returnType)} => ${arrowBodyText(state, node)}`
  state.out += parenthesizedIf(PREC.Assignment < prec, arrow)
}

function arrowParamsText(state: PrintState, node: ArrowFunctionExpression): string {
  const bareParam = bareArrowParamName(node)
  if (bareParam.length === 0) return `(${paramsText(state, node.params)})`
  return bareParam
}

function arrowBodyText(state: PrintState, node: ArrowFunctionExpression): string {
  const body = node.body
  if (arrowBodyIsBlock(body)) return capture(state, () => printBlockStatement(state, body))
  return assignmentNodeText(state, body)
}

function printFunction(state: PrintState, node: FunctionNode, _prec: number): void {
  state.out += functionHeaderText(node)
  printFunctionTail(state, node)
}

function printClass(state: PrintState, node: Class, _prec: number): void {
  state.out += capture(state, () => printDecorators(state, node.decorators))
  state.out += `${flagText(node.declare, 'declare ')}${flagText(node.abstract, 'abstract ')}class${
    namedDeclarationText(node)
  }`
  state.out += typeParametersText(state, node.typeParameters)
  state.out += classHeritageText(state, node)
  state.out += classImplementsText(state, node)
  state.out += ' '
  printClassBody(state, node.body)
}

function classHeritageText(state: PrintState, node: Class): string {
  if (node.superClass !== null) {
    return ` extends ${assignmentNodeText(state, node.superClass)}${typeArgumentsText(state, node.superTypeArguments)}`
  }
  return ''
}

function classImplementsText(state: PrintState, node: Class): string {
  const rendered = (node.implements ?? []).map((heritage) => heritageText(state, heritage)).join(', ')
  return flagText(rendered, ` implements ${rendered}`)
}

function heritageText(
  state: PrintState,
  heritage: {
    readonly expression: Node
    readonly typeArguments?: TSTypeParameterInstantiation | null
  },
): string {
  return `${assignmentNodeText(state, heritage.expression)}${typeArgumentsText(state, heritage.typeArguments)}`
}

function printDecorators(state: PrintState, decorators: readonly Decorator[] | undefined): void {
  const rendered = (decorators ?? []).map((decorator) => decoratorText(state, decorator)).join(' ')
  state.out += flagText(rendered, `${rendered} `)
}

function decoratorText(state: PrintState, decorator: Decorator): string {
  return `@${capture(state, () => printNodePrec(state, decorator.expression, PREC.Member))}`
}

function printJSXElement(state: PrintState, node: JSXElement): void {
  printJSXOpeningElement(state, node.openingElement)
  node.children.forEach((child) => printJSXChild(state, child))
  printJSXClosingElement(state, node)
}

function printJSXClosingElement(state: PrintState, node: JSXElement): void {
  if (node.closingElement === null) return
  state.out += `</${jsxElementNameText(state, node.closingElement.name)}>`
}

function printJSXFragment(state: PrintState, node: JSXFragment): void {
  state.out += '<>'
  for (const child of node.children) {
    printJSXChild(state, child)
  }
  state.out += '</>'
}

function printJSXOpeningElement(state: PrintState, node: JSXOpeningElement): void {
  state.out += `<${jsxElementNameText(state, node.name)}`
  state.out += typeArgumentsText(state, node.typeArguments)
  state.out += node.attributes
    .map((attribute) => ` ${sequenceNodeText(state, attribute)}`)
    .join('')
  if (node.selfClosing) {
    state.out += ' />'
    return
  }
  state.out += '>'
}

function jsxElementNameText(state: PrintState, name: JSXOpeningElement['name']): string {
  switch (name.type) {
    case 'JSXIdentifier':
      return name.name
    case 'JSXNamespacedName':
      return `${name.namespace.name}:${name.name.name}`
    case 'JSXMemberExpression':
      return capture(state, () => printJSXMemberExpression(state, name))
  }
}

function printJSXMemberExpression(state: PrintState, node: JSXMemberExpression): void {
  const obj = node.object
  if (obj.type === 'JSXIdentifier') {
    state.out += `${obj.name}.${node.property.name}`
    return
  }
  printJSXMemberExpression(state, obj)
  state.out += `.${node.property.name}`
}

function printJSXAttribute(state: PrintState, node: JSXAttribute): void {
  state.out += jsxAttributeNameText(node.name)
  state.out += jsxAttributeValueClauseText(state, node.value)
}

function jsxAttributeValueClauseText(state: PrintState, value: JSXAttribute['value']): string {
  if (value === null) return ''
  return `=${jsxAttributeValueText(state, value)}`
}

function jsxAttributeValueText(state: PrintState, value: NonNullable<JSXAttribute['value']>): string {
  switch (value.type) {
    case 'Literal':
      return capture(state, () => printLiteral(state, value))
    case 'JSXExpressionContainer':
      return `{${sequenceNodeText(state, value.expression)}}`
    case 'JSXElement':
    case 'JSXFragment':
      return sequenceNodeText(state, value)
  }
}

function printJSXChild(state: PrintState, child: JSXElement['children'][number]): void {
  switch (child.type) {
    case 'JSXText':
      state.out += child.value
      return
    case 'JSXElement':
      printJSXElement(state, child)
      return
    case 'JSXFragment':
      printJSXFragment(state, child)
      return
    case 'JSXExpressionContainer':
      state.out += '{'
      printNodePrec(state, child.expression, PREC.Sequence)
      state.out += '}'
      return
    case 'JSXSpreadChild':
      state.out += '{...'
      printNodePrec(state, child.expression, PREC.Assignment)
      state.out += '}'
  }
}

function printTSAsExpression(state: PrintState, node: TSAsExpression, prec: number): void {
  const myPrec = PREC.Relational
  const exprStr = printExpressionToString(state, node.expression, myPrec)
  const typeStr = printTSTypeToString(state, node.typeAnnotation)
  const whole = `${exprStr} as ${typeStr}`
  if (myPrec < prec) state.out += `(${whole})`
  else state.out += whole
}

function printTSSatisfiesExpression(state: PrintState, node: TSSatisfiesExpression, prec: number): void {
  const myPrec = PREC.Relational
  const exprStr = printExpressionToString(state, node.expression, myPrec)
  const typeStr = printTSTypeToString(state, node.typeAnnotation)
  const whole = `${exprStr} satisfies ${typeStr}`
  if (myPrec < prec) state.out += `(${whole})`
  else state.out += whole
}

function printTSTypeAssertion(state: PrintState, node: TSTypeAssertion, _prec: number): void {
  state.out += `<${printTSTypeToString(state, node.typeAnnotation)}>`
  printNodePrec(state, node.expression, PREC.Unary)
}

function printTSInstantiationExpression(state: PrintState, node: TSInstantiationExpression, _prec: number): void {
  printNodePrec(state, node.expression, PREC.Member)
  printTSTypeParameterInstantiation(state, node.typeArguments)
}

function printStatement(state: PrintState, node: Statement): void {
  printAttachedComments(state, node, 'leadingComments')
  printStatementKind(state, node)
  printAttachedComments(state, node, 'trailingComments')
}

function printStatementKind(state: PrintState, node: Statement): void {
  switch (node.type) {
    case 'BlockStatement':
      printBlockStatement(state, node)
      break
    case 'VariableDeclaration':
      printVariableDeclaration(state, node)
      state.out += ';'
      break
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'TSDeclareFunction':
    case 'TSEmptyBodyFunctionExpression':
      printFunction(state, node, PREC.Sequence)
      break
    case 'ClassDeclaration':
    case 'ClassExpression':
      printClass(state, node, PREC.Sequence)
      break
    case 'ExpressionStatement':
      printExpressionStatement(state, node)
      break
    case 'IfStatement':
      printIfStatement(state, node)
      break
    case 'ForStatement':
      printForStatement(state, node)
      break
    case 'ForInStatement':
      printForInStatement(state, node)
      break
    case 'ForOfStatement':
      printForOfStatement(state, node)
      break
    case 'WhileStatement':
      printWhileStatement(state, node)
      break
    case 'DoWhileStatement':
      printDoWhileStatement(state, node)
      break
    case 'ReturnStatement':
      printReturnStatement(state, node)
      break
    case 'ThrowStatement':
      state.out += 'throw '
      printNodePrec(state, node.argument, PREC.Sequence)
      state.out += ';'
      break
    case 'TryStatement':
      printTryStatement(state, node)
      break
    case 'SwitchStatement':
      printSwitchStatement(state, node)
      break
    case 'LabeledStatement':
      printLabeledStatement(state, node)
      break
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'DebuggerStatement':
    case 'EmptyStatement':
      printNodePrec(state, node, PREC.Sequence)
      break
    case 'WithStatement':
      printWithStatement(state, node)
      break
    case 'ImportDeclaration':
      printImportDeclaration(state, node)
      break
    case 'ExportNamedDeclaration':
      printExportNamedDeclaration(state, node)
      break
    case 'ExportDefaultDeclaration':
      printExportDefaultDeclaration(state, node)
      break
    case 'ExportAllDeclaration':
      printExportAllDeclaration(state, node)
      break
    case 'TSTypeAliasDeclaration':
      printTSTypeAliasDeclaration(state, node)
      break
    case 'TSInterfaceDeclaration':
      printTSInterfaceDeclaration(state, node)
      break
    case 'TSEnumDeclaration':
      printTSEnumDeclaration(state, node)
      break
    case 'TSModuleDeclaration':
      printTSModuleDeclaration(state, node)
      break
    case 'TSImportEqualsDeclaration':
      printTSImportEqualsDeclaration(state, node)
      break
    case 'TSExportAssignment':
    case 'TSNamespaceExportDeclaration':
      printNodePrec(state, node, PREC.Sequence)
      break
  }
}

function printAttachedComments(
  state: PrintState,
  node: CommentHost,
  field: 'leadingComments' | 'trailingComments',
): void {
  const comments = node[field]
  if (comments === undefined) return
  comments.forEach((comment) => printAttachedComment(state, comment, field))
}

function printAttachedComment(
  state: PrintState,
  comment: AttachedComment,
  field: 'leadingComments' | 'trailingComments',
): void {
  if (field === 'leadingComments') {
    state.out += `${indent(state)}${commentText(comment)}\n`
    return
  }
  state.out += `${commentText(comment)} `
}

function printBlockStatement(state: PrintState, node: Extract<Node, { type: 'BlockStatement' }>): void {
  switch (node.body.length) {
    case 0:
      state.out += '{}'
      break
    default:
      state.out += '{\n'
      state.out += indentedBodyText(state, node.body, (statement) => printStatement(state, statement))
      state.out += `${indent(state)}}`
  }
}

function printExpressionStatement(state: PrintState, node: ExpressionStatement): void {
  if (isDirective(node.directive)) {
    state.out += JSON.stringify(node.directive) + ';'
    return
  }
  printNodePrec(state, node.expression, PREC.Sequence)
  state.out += ';'
}

function isDirective(directive: string | null | undefined): boolean {
  return directive != null && directive !== ''
}

function printIfStatement(state: PrintState, node: IfStatement): void {
  state.out += 'if ('
  printNodePrec(state, node.test, PREC.Sequence)
  state.out += ') '
  printStatementOrBlock(state, node.consequent)
  if (node.alternate !== null) {
    state.out += ' else '
    printStatementOrBlock(state, node.alternate)
  }
}

function printStatementOrBlock(state: PrintState, node: Statement): void {
  if (node.type === 'BlockStatement') {
    printBlockStatement(state, node)
    return
  }
  printStatement(state, node)
}

function printWhileStatement(state: PrintState, node: WhileStatement): void {
  state.out += 'while ('
  printNodePrec(state, node.test, PREC.Sequence)
  state.out += ') '
  printStatementOrBlock(state, node.body)
}

function printDoWhileStatement(state: PrintState, node: DoWhileStatement): void {
  state.out += 'do '
  printStatementOrBlock(state, node.body)
  state.out += ' while ('
  printNodePrec(state, node.test, PREC.Sequence)
  state.out += ');'
}

function printForStatement(state: PrintState, node: ForStatement): void {
  state.out += 'for ('
  printDeclarationOrExpression(state, node.init)
  state.out += '; '
  state.out += optionalSequenceText(state, node.test)
  state.out += '; '
  state.out += optionalSequenceText(state, node.update)
  state.out += ') '
  printStatementOrBlock(state, node.body)
}

function printDeclarationOrExpression(state: PrintState, node: Node | null | undefined): void {
  if (node == null) return
  printDeclarationOrExpressionNode(state, node)
}

function printDeclarationOrExpressionNode(state: PrintState, node: Node): void {
  if (node.type === 'VariableDeclaration') {
    printVariableDeclaration(state, node)
    return
  }
  printNodePrec(state, node, PREC.Sequence)
}

function optionalSequenceText(state: PrintState, node: Node | null | undefined): string {
  if (node == null) return ''
  return sequenceNodeText(state, node)
}

function printForInStatement(state: PrintState, node: ForInStatement): void {
  state.out += 'for ('
  if (node.left.type === 'VariableDeclaration') {
    printVariableDeclaration(state, node.left)
  } else {
    printNodePrec(state, node.left, PREC.Sequence)
  }
  state.out += ' in '
  printNodePrec(state, node.right, PREC.Sequence)
  state.out += ') '
  printStatementOrBlock(state, node.body)
}

function printForOfStatement(state: PrintState, node: ForOfStatement): void {
  if (node.await) {
    state.out += 'for await ('
  } else {
    state.out += 'for ('
  }
  printDeclarationOrExpression(state, node.left)
  state.out += ' of '
  state.out += sequenceNodeText(state, node.right)
  state.out += ') '
  printStatementOrBlock(state, node.body)
}

function printReturnStatement(state: PrintState, node: ReturnStatement): void {
  if (node.argument !== null) {
    state.out += 'return '
    printNodePrec(state, node.argument, PREC.Sequence)
    state.out += ';'
    return
  }
  state.out += 'return;'
}

function printWithStatement(state: PrintState, node: WithStatement): void {
  state.out += 'with ('
  printNodePrec(state, node.object, PREC.Sequence)
  state.out += ') '
  printStatementOrBlock(state, node.body)
}

function printSwitchStatement(state: PrintState, node: SwitchStatement): void {
  state.out += `switch (${sequenceNodeText(state, node.discriminant)}) {\n`
  state.indentLevel++
  state.out += node.cases
    .map((switchCase) => `${indent(state)}${capture(state, () => printSwitchCase(state, switchCase))}`)
    .join('')
  state.indentLevel--
  state.out += `${indent(state)}}`
}

function printSwitchCase(state: PrintState, node: SwitchCase): void {
  state.out += switchCaseHeaderText(state, node)
  state.out += indentedBodyText(state, node.consequent, (statement: Statement) => printStatement(state, statement))
}

function switchCaseHeaderText(state: PrintState, node: SwitchCase): string {
  if (node.test !== null) return `case ${sequenceNodeText(state, node.test)}:\n`
  return 'default:\n'
}

function printLabeledStatement(state: PrintState, node: LabeledStatement): void {
  state.out += `${node.label.name}: `
  printStatement(state, node.body)
}

function printTryStatement(state: PrintState, node: TryStatement): void {
  state.out += 'try '
  printBlockStatement(state, node.block)
  printCatchClause(state, node.handler)
  printFinallyClause(state, node.finalizer)
}

function printCatchClause(state: PrintState, handler: CatchClause | null | undefined): void {
  if (handler == null) return
  state.out += ` catch${catchParamText(state, handler.param)} `
  printBlockStatement(state, handler.body)
}

function catchParamText(state: PrintState, param: BindingPattern | null | undefined): string {
  if (param == null) return ''
  return ` (${catchParamBodyText(state, param)})`
}

function catchParamBodyText(state: PrintState, param: BindingPattern): string {
  if (param.type === 'Identifier') return identifierWithOptionalText(state, param)
  return sequenceNodeText(state, param)
}

function printFinallyClause(state: PrintState, finalizer: BlockStatement | null | undefined): void {
  if (finalizer == null) return
  state.out += ' finally '
  printBlockStatement(state, finalizer)
}

function printVariableDeclaration(state: PrintState, node: VariableDeclaration): void {
  state.out += `${flagText(node.declare, 'declare ')}${node.kind} `
  state.out += node.declarations.map((declaration) => variableDeclaratorText(state, declaration)).join(', ')
}

function variableDeclaratorText(state: PrintState, node: VariableDeclarator): string {
  return capture(state, () => printVariableDeclarator(state, node))
}

function printVariableDeclarator(state: PrintState, node: VariableDeclarator): void {
  state.out += bindingTargetText(state, node.id)
  state.out += flagText(node.definite, '!')
  state.out += typeAnnotationText(state, bindingTypeAnnotation(node.id))
  state.out += initializerText(state, node.init)
}

function bindingTargetText(state: PrintState, id: BindingPattern): string {
  if (id.type === 'Identifier') return `${bindingNameText(id)}${flagText(id.optional, '?')}`
  return sequenceNodeText(state, id)
}

function identifierWithOptionalText(state: PrintState, node: BindingIdentifier): string {
  return `${bindingNameText(node)}${flagText(node.optional, '?')}${typeAnnotationText(state, node.typeAnnotation)}`
}

function printParams(state: PrintState, params: readonly ParamPattern[]): void {
  state.out += params.map((param) => paramText(state, param)).join(', ')
}

function paramText(state: PrintState, param: ParamPattern): string {
  switch (param.type) {
    case 'RestElement':
      return restParamText(state, param)
    case 'TSParameterProperty':
      return parameterPropertyText(state, param)
    case 'Identifier':
    case 'ObjectPattern':
    case 'ArrayPattern':
    case 'AssignmentPattern':
      return formalParameterText(state, param)
  }
}

function restParamText(state: PrintState, param: Extract<ParamPattern, { readonly type: 'RestElement' }>): string {
  return `...${assignmentNodeText(state, param.argument)}${typeAnnotationText(state, param.typeAnnotation)}`
}

function parameterPropertyText(
  state: PrintState,
  param: Extract<ParamPattern, { readonly type: 'TSParameterProperty' }>,
): string {
  return `${capture(state, () => printDecorators(state, param.decorators))}${parameterPropertyModifiers(param)}${
    parameterPropertyTargetText(state, param.parameter)
  }`
}

function parameterPropertyTargetText(state: PrintState, parameter: BindingPattern): string {
  if (parameter.type === 'Identifier') return identifierWithOptionalText(state, parameter)
  return sequenceNodeText(state, parameter)
}

function formalParameterText(state: PrintState, param: BindingPattern): string {
  return `${capture(state, () => printDecorators(state, param.decorators))}${formalParameterBodyText(state, param)}`
}

function formalParameterBodyText(state: PrintState, param: BindingPattern): string {
  if (param.type === 'Identifier') return identifierWithOptionalText(state, param)
  return `${assignmentNodeText(state, param)}${typeAnnotationText(state, bindingTypeAnnotation(param))}`
}

function printClassBody(state: PrintState, node: ClassBody): void {
  switch (node.body.length) {
    case 0:
      state.out += '{}'
      break
    default:
      state.out += '{\n'
      state.out += indentedBodyText(state, node.body, (element) => printNodePrec(state, element, PREC.Sequence))
      state.out += `${indent(state)}}`
  }
}

function indentedBodyText<T>(state: PrintState, items: readonly T[], print: (item: T) => void): string {
  state.indentLevel++
  const body = items.map((item) => `${indent(state)}${capture(state, () => print(item))}\n`).join('')
  state.indentLevel--
  return body
}

function printMethodDefinition(state: PrintState, node: MethodDefinition): void {
  const fn = node.value
  state.out += capture(state, () => printDecorators(state, node.decorators))
  state.out += methodDefinitionPrefix(node, fn)
  state.out += propertyKeyText(state, node.key, node.computed === true, PREC.Sequence)
  state.out += flagText(node.optional, '?')
  printFunctionTail(state, fn)
}

function printPropertyDefinition(state: PrintState, node: PropertyDefinition): void {
  state.out += capture(state, () => printDecorators(state, node.decorators))
  state.out += propertyDefinitionModifiers(node)
  state.out += propertyKeyText(state, node.key, node.computed === true, PREC.Sequence)
  state.out += flagText(node.optional, '?')
  state.out += flagText(node.definite, '!')
  state.out += typeAnnotationText(state, node.typeAnnotation)
  state.out += initializerText(state, node.value)
  state.out += ';'
}

function printAccessorProperty(state: PrintState, node: AccessorProperty): void {
  state.out += capture(state, () => printDecorators(state, node.decorators))
  state.out += flagText(node.accessibility, `${node.accessibility} `)
  state.out += flagText(node.static, 'static ')
  state.out += flagText(node.override, 'override ')
  state.out += 'accessor '
  state.out += propertyKeyText(state, node.key, node.computed === true, PREC.Sequence)
  state.out += flagText(node.definite, '!')
  state.out += typeAnnotationText(state, node.typeAnnotation)
  state.out += initializerText(state, node.value)
  state.out += ';'
}

function initializerText(state: PrintState, value: Node | null | undefined): string {
  return flagText(value, ` = ${assignmentNodeText(state, value)}`)
}

function printStaticBlock(state: PrintState, node: StaticBlock): void {
  state.out += 'static {\n'
  state.indentLevel++
  for (const stmt of node.body) {
    state.out += indent(state)
    printStatement(state, stmt)
    state.out += '\n'
  }
  state.indentLevel--
  state.out += `${indent(state)}}`
}

function printImportDeclaration(state: PrintState, node: ImportDeclaration): void {
  const source = printImportSource(node.source, node.attributes)
  state.out += `import ${importKindText(node)}${importClauseText(node, source)};`
}

function importClauseText(node: ImportDeclaration, source: string): string {
  if (node.specifiers.length === 0) return source
  return `${importBindingsText(node.specifiers)} from ${source}`
}

function printImportSource(source: StringLiteral, attrs: readonly ImportAttribute[]): string {
  const raw = source.raw ?? JSON.stringify(source.value)
  return `${raw}${importAttributesText(attrs)}`
}

function printExportNamedDeclaration(state: PrintState, node: ExportNamedDeclaration): void {
  const declaration = node.declaration
  if (declaration !== null) {
    state.out += `export ${capture(state, () => printStatement(state, declaration))}`
    return
  }
  state.out += `export ${flagText(node.exportKind === 'type', 'type ')}{ ${
    node.specifiers.map((specifier) => exportSpecifierText(specifier)).join(', ')
  } }${exportSourceClauseText(node)};`
}

function exportSourceClauseText(node: ExportNamedDeclaration): string {
  if (node.source === null) return ''
  const rendered = ` from ${JSON.stringify(node.source.value)}${importAttributesText(node.attributes)}`
  return rendered
}

function printExportDefaultDeclaration(state: PrintState, node: ExportDefaultDeclaration): void {
  state.out += 'export default '
  printExportDefaultDeclarationBody(state, node.declaration)
}

function printExportDefaultDeclarationBody(
  state: PrintState,
  declaration: ExportDefaultDeclaration['declaration'],
): void {
  if (isBareDefaultExport(declaration)) {
    printStatement(state, declaration)
    return
  }
  printNodePrec(state, declaration, PREC.Assignment)
  state.out += ';'
}

function printExportAllDeclaration(state: PrintState, node: ExportAllDeclaration): void {
  state.out += `export ${flagText(node.exportKind === 'type', 'type ')}*${exportedNameClauseText(node.exported)}`
  state.out += ` from ${JSON.stringify(node.source.value)}${importAttributesText(node.attributes)};`
}

function printTSTypeAliasDeclaration(state: PrintState, node: TSTypeAliasDeclaration): void {
  state.out += `${flagText(node.declare, 'declare ')}type ${node.id.name}${
    typeParametersText(state, node.typeParameters)
  } = ${printTSTypeToString(state, node.typeAnnotation)};`
}

function printTSInterfaceDeclaration(state: PrintState, node: TSInterfaceDeclaration): void {
  state.out += `${flagText(node.declare, 'declare ')}interface ${node.id.name}${
    typeParametersText(state, node.typeParameters)
  }`
  state.out += interfaceExtendsText(state, node.extends)
  state.out += ' '
  printTSInterfaceBody(state, node.body)
}

function interfaceExtendsText(state: PrintState, extensions: TSInterfaceDeclaration['extends']): string {
  const rendered = extensions.map((heritage) => heritageText(state, heritage)).join(', ')
  return flagText(rendered, ` extends ${rendered}`)
}

function printTSInterfaceBody(state: PrintState, node: TSInterfaceBody): void {
  switch (node.body.length) {
    case 0:
      state.out += '{}'
      break
    default:
      state.out += '{\n'
      state.out += indentedBodyText(state, node.body, (member) => printTSSignature(state, member))
      state.out += `${indent(state)}}`
  }
}

function printTSSignature(state: PrintState, sig: TSInterfaceBody['body'][number]): void {
  switch (sig.type) {
    case 'TSPropertySignature':
      printTSPropertySignature(state, sig)
      return
    case 'TSIndexSignature':
      printTSIndexSignature(state, sig)
      return
    case 'TSCallSignatureDeclaration':
      printTSCallSignature(state, sig)
      return
    case 'TSConstructSignatureDeclaration':
      printTSConstructSignature(state, sig)
      return
    case 'TSMethodSignature':
      printTSMethodSignature(state, sig)
  }
}

function printTSPropertySignature(state: PrintState, node: TSPropertySignature): void {
  state.out += `${flagText(node.readonly, 'readonly ')}${
    propertyKeyText(state, node.key, node.computed === true, PREC.Sequence)
  }${flagText(node.optional, '?')}${typeAnnotationText(state, node.typeAnnotation)};`
}

function printTSIndexSignature(state: PrintState, node: TSIndexSignature): void {
  const parameters = node.parameters.map((parameter) => indexParameterText(state, parameter)).join(', ')
  state.out += `${flagText(node.readonly, 'readonly ')}${flagText(node.static, 'static ')}[${parameters}]${
    typeAnnotationText(state, node.typeAnnotation)
  };`
}

function indexParameterText(state: PrintState, parameter: TSIndexSignature['parameters'][number]): string {
  return `${parameter.name}: ${printTSTypeToString(state, parameter.typeAnnotation.typeAnnotation)}`
}

function printTSCallSignature(state: PrintState, node: TSCallSignatureDeclaration): void {
  state.out += `${typeParametersText(state, node.typeParameters)}(${paramsText(state, node.params)})${
    typeAnnotationText(state, node.returnType)
  };`
}

function printTSConstructSignature(state: PrintState, node: TSConstructSignatureDeclaration): void {
  state.out += `new ${typeParametersText(state, node.typeParameters)}(${paramsText(state, node.params)})${
    typeAnnotationText(state, node.returnType)
  };`
}

function printTSMethodSignature(state: PrintState, node: TSMethodSignature): void {
  state.out += `${methodKindText(node.kind)}${propertyKeyText(state, node.key, node.computed === true, PREC.Sequence)}${
    flagText(node.optional, '?')
  }${typeParametersText(state, node.typeParameters)}(${paramsText(state, node.params)})${
    typeAnnotationText(state, node.returnType)
  };`
}

function printTSEnumDeclaration(state: PrintState, node: TSEnumDeclaration): void {
  state.out += `${flagText(node.declare, 'declare ')}${flagText(node.const, 'const ')}enum ${node.id.name} {\n`
  state.out += indentedBodyText(state, node.body.members, (member) => printEnumMember(state, member))
  state.out += `${indent(state)}}`
}

function printEnumMember(state: PrintState, member: TSEnumDeclaration['body']['members'][number]): void {
  state.out += `${identifierOrLiteralNameText(state, member.id)}${initializerText(state, member.initializer)},`
}

function identifierOrLiteralNameText(state: PrintState, id: Node): string {
  switch (nodeKind(id)) {
    case 'Identifier':
      return identifierNameText(id)
    case 'Literal':
      return literalCapture(state, id)
    default:
      return sequenceNodeText(state, id)
  }
}

function printTSModuleDeclaration(state: PrintState, node: Extract<Node, { type: 'TSModuleDeclaration' }>): void {
  state.out += `${flagText(node.declare, 'declare ')}${moduleHeaderText(state, node)}${moduleBodyText(state, node)}`
}

function moduleHeaderText(state: PrintState, node: Extract<Node, { type: 'TSModuleDeclaration' }>): string {
  if (node.global) return 'global '
  return `${node.kind} ${identifierOrLiteralNameText(state, node.id)}`
}

function moduleBodyText(state: PrintState, node: Extract<Node, { type: 'TSModuleDeclaration' }>): string {
  const body = node.body
  if (body !== null) return ` ${capture(state, () => printTSModuleBlock(state, body))}`
  return ';'
}

function printTSModuleBlock(state: PrintState, node: Extract<Node, { type: 'TSModuleBlock' }>): void {
  state.out += '{\n'
  state.out += indentedBodyText(state, node.body, (statement) => printStatement(state, statement))
  state.out += `${indent(state)}}`
}

function printTSImportEqualsDeclaration(state: PrintState, node: TSImportEqualsDeclaration): void {
  state.out += `import ${flagText(node.importKind === 'type', 'type ')}${node.id.name} = ${
    moduleReferenceText(state, node.moduleReference)
  };`
}

function moduleReferenceText(state: PrintState, reference: TSImportEqualsDeclaration['moduleReference']): string {
  if (reference.type === 'TSExternalModuleReference') {
    return `require(${externalModuleArgumentText(reference.expression.value)})`
  }
  return sequenceNodeText(state, reference)
}

function printTSType(state: PrintState, node: TSType): void {
  state.out += printTSTypeToString(state, node)
}

function printTSTypeToString(state: PrintState, node: TSType): string {
  const saved = state.out
  state.out = ''
  doPrintTSType(state, node)
  const result = state.out
  state.out = saved
  return result
}

function doPrintTSType(state: PrintState, node: TSType): void {
  switch (node.type) {
    case 'TSAnyKeyword':
      state.out += 'any'
      break
    case 'TSStringKeyword':
      state.out += 'string'
      break
    case 'TSBooleanKeyword':
      state.out += 'boolean'
      break
    case 'TSNumberKeyword':
      state.out += 'number'
      break
    case 'TSBigIntKeyword':
      state.out += 'bigint'
      break
    case 'TSSymbolKeyword':
      state.out += 'symbol'
      break
    case 'TSVoidKeyword':
      state.out += 'void'
      break
    case 'TSUndefinedKeyword':
      state.out += 'undefined'
      break
    case 'TSNullKeyword':
      state.out += 'null'
      break
    case 'TSNeverKeyword':
      state.out += 'never'
      break
    case 'TSUnknownKeyword':
      state.out += 'unknown'
      break
    case 'TSObjectKeyword':
      state.out += 'object'
      break
    case 'TSIntrinsicKeyword':
      state.out += 'intrinsic'
      break
    case 'TSThisType':
      state.out += 'this'
      break
    case 'TSTypeReference':
      printTSTypeName(state, node.typeName)
      state.out += typeArgumentsText(state, node.typeArguments)
      break
    case 'TSUnionType':
      state.out += tSTypeListText(state, node.types, ' | ')
      break
    case 'TSIntersectionType':
      state.out += tSTypeListText(state, node.types, ' & ')
      break
    case 'TSArrayType':
      state.out += `${arrayElementTypeText(state, node.elementType)}[]`
      break
    case 'TSTypeLiteral':
      printTSTypeLiteral(state, node.members)
      break
    case 'TSTupleType':
      printTupleType(state, node.elementTypes)
      break
    case 'TSConditionalType':
      doPrintTSType(state, node.checkType)
      state.out += ' extends '
      doPrintTSType(state, node.extendsType)
      state.out += ' ? '
      doPrintTSType(state, node.trueType)
      state.out += ' : '
      doPrintTSType(state, node.falseType)
      break
    case 'TSInferType':
      state.out += `infer ${node.typeParameter.name.name}`
      printTypeClause(state, ' extends ', node.typeParameter.constraint)
      break
    case 'TSTypeQuery':
      state.out += 'typeof '
      printTypeQueryName(state, node)
      state.out += typeArgumentsText(state, node.typeArguments)
      break
    case 'TSImportType':
      printTSImportType(state, node)
      break
    case 'TSTypeOperator':
      state.out += `${node.operator} `
      doPrintTSType(state, node.typeAnnotation)
      break
    case 'TSMappedType':
      printMappedType(state, node)
      break
    case 'TSTemplateLiteralType':
      printTSTemplateLiteral(state, node)
      break
    case 'TSFunctionType':
      printTSFunctionType(state, node)
      break
    case 'TSConstructorType':
      printTSConstructorType(state, node)
      break
    case 'TSTypePredicate':
      printTSTypePredicate(state, node)
      break
    case 'TSIndexedAccessType':
      doPrintTSType(state, node.objectType)
      state.out += '['
      doPrintTSType(state, node.indexType)
      state.out += ']'
      break
    case 'TSNamedTupleMember':
      printNamedTupleMember(state, node)
      break
    case 'TSLiteralType':
      printTSLiteralType(state, node.literal)
      break
    case 'TSParenthesizedType':
      state.out += '('
      doPrintTSType(state, node.typeAnnotation)
      state.out += ')'
      break
    case 'TSJSDocNullableType':
      printJSDocPostfixModifier(state, node, '?')
      break
    case 'TSJSDocNonNullableType':
      printJSDocPostfixModifier(state, node, '!')
      break
    case 'TSJSDocUnknownType':
      state.out += '?'
      break
  }
}

function tSTypeListText(state: PrintState, types: readonly TSType[], separator: string): string {
  return types.map((type) => printTSTypeToString(state, type)).join(separator)
}

function arrayElementTypeText(state: PrintState, type: TSType): string {
  const printed = printTSTypeToString(state, type)
  if (ARRAY_ELEMENT_WRAPPED_KINDS[type.type] === true) return `(${printed})`
  return printed
}

function printTSTypeLiteral(state: PrintState, members: readonly TSInterfaceBody['body'][number][]): void {
  const rendered = members.map((member) => signatureText(state, member)).join('; ')
  switch (members.length) {
    case 0:
      state.out += '{}'
      break
    default:
      state.out += `{ ${rendered} }`
  }
}

function signatureText(state: PrintState, member: TSInterfaceBody['body'][number]): string {
  const printed = capture(state, () => printTSSignature(state, member))
  if (printed.endsWith(';')) return printed.slice(0, -1)
  return printed
}

function printTupleType(state: PrintState, elements: TSTupleType['elementTypes']): void {
  state.out += `[${elements.map((element) => capture(state, () => printTupleElement(state, element))).join(', ')}]`
}

function printTupleElement(state: PrintState, element: TSTupleType['elementTypes'][number]): void {
  switch (nodeKind(element)) {
    case 'TSRestType':
      printRestTupleElement(state, element)
      break
    case 'TSOptionalType':
      printOptionalTupleElement(state, element)
      break
    case 'TSNamedTupleMember':
      printNamedTupleElement(state, element)
      break
    default:
      printTupleElementType(state, element)
  }
}

function printRestTupleElement(state: PrintState, element: TSTupleType['elementTypes'][number]): void {
  if (isNodeOfKind(element, 'TSRestType')) {
    state.out += '...'
    doPrintTSType(state, element.typeAnnotation)
  }
}

function printOptionalTupleElement(state: PrintState, element: TSTupleType['elementTypes'][number]): void {
  if (isNodeOfKind(element, 'TSOptionalType')) {
    doPrintTSType(state, element.typeAnnotation)
    state.out += '?'
  }
}

function printNamedTupleElement(state: PrintState, element: TSTupleType['elementTypes'][number]): void {
  if (isNodeOfKind(element, 'TSNamedTupleMember')) printNamedTupleMember(state, element)
}

function printTupleElementType(state: PrintState, element: TSTupleType['elementTypes'][number]): void {
  if (isTSType(element)) doPrintTSType(state, element)
}

function printNamedTupleMember(state: PrintState, member: TSNamedTupleMember): void {
  state.out += `${member.label.name}${flagText(member.optional, '?')}: `
  printTupleElement(state, member.elementType)
}

function printTypeClause(state: PrintState, keyword: string, type: TSType | null | undefined): void {
  if (type == null) return
  state.out += keyword
  doPrintTSType(state, type)
}

function printTypeQueryName(state: PrintState, node: TSTypeQuery): void {
  const exprName = node.exprName
  if (exprName.type === 'TSImportType') {
    doPrintTSType(state, exprName)
    return
  }
  printTSTypeName(state, exprName)
}

function printTSTypeName(state: PrintState, name: TSTypeReference['typeName']): void {
  if (name.type === 'TSQualifiedName') {
    printTSTypeName(state, name.left)
    state.out += `.${name.right.name}`
    return
  }
  state.out += tSTypeNameLeafText(state, name)
}

function tSTypeNameLeafText(state: PrintState, name: TSTypeReference['typeName']): string {
  switch (name.type) {
    case 'Identifier':
      return name.name
    case 'ThisExpression':
      return 'this'
    case 'TSQualifiedName':
      return sequenceNodeText(state, name)
  }
}

function printTSImportTypeQualifier(state: PrintState, qualifier: TSImportType['qualifier']): void {
  if (qualifier === null) return
  printTSImportTypeQualifierNode(state, qualifier)
}

function printTSImportTypeQualifierNode(
  state: PrintState,
  qualifier: NonNullable<TSImportType['qualifier']>,
): void {
  if (qualifier.type === 'Identifier') {
    state.out += qualifier.name
    return
  }
  printTSImportTypeQualifier(state, qualifier.left)
  state.out += `.${qualifier.right.name}`
}

function printTSImportType(state: PrintState, node: TSImportType): void {
  printTSImportTypeSource(state, node)
  if (node.qualifier !== null) {
    state.out += '.'
    printTSImportTypeQualifier(state, node.qualifier)
  }
  state.out += typeArgumentsText(state, node.typeArguments)
}

function printTSImportTypeSource(state: PrintState, node: TSImportType): void {
  state.out += `import(${JSON.stringify(node.source.value)}`
  state.out += flagText(node.options, `, ${assignmentNodeText(state, node.options)}`)
  state.out += ')'
}

function printMappedType(state: PrintState, node: TSMappedType): void {
  state.out += '{ '
  printMappedTypeModifier(state, node.readonly, 'readonly ')
  state.out += `[${node.key.name} in `
  doPrintTSType(state, node.constraint)
  printTypeClause(state, ' as ', node.nameType)
  state.out += ']'
  printMappedTypeModifier(state, node.optional, '?')
  printTypeClause(state, ': ', node.typeAnnotation)
  state.out += ' }'
}

function printMappedTypeModifier<A = unknown>(state: PrintState, modifier: A, rendered: string): void {
  switch (modifier) {
    case true:
      state.out += rendered
      break
    case '+':
      state.out += `+${rendered}`
      break
    case '-':
      state.out += `-${rendered}`
      break
    default:
      break
  }
}

function printTSTemplateLiteral(state: PrintState, node: TSTemplateLiteralType): void {
  state.out += `\`${
    node.quasis
      .map((quasi, index) => templateTypeQuasiText(state, quasi, node.types[index]))
      .join('')
  }\``
}

function templateTypeQuasiText(state: PrintState, quasi: TemplateElement, type: TSType | undefined): string {
  switch (quasi.tail) {
    case true:
      return quasi.value.raw
    case false:
      return templateTypeText(state, quasi, type)
  }
}

function templateTypeText(state: PrintState, quasi: TemplateElement, type: TSType | undefined): string {
  if (type === undefined) throw new Error('Printer: template literal type has no type for its quasi')
  return `${quasi.value.raw}\${${printTSTypeToString(state, type)}}`
}

function printTSFunctionType(state: PrintState, node: TSFunctionType): void {
  state.out += `${typeParametersText(state, node.typeParameters)}(${paramsText(state, node.params)}) => ${
    printTSTypeToString(state, node.returnType.typeAnnotation)
  }`
}

function printTSConstructorType(state: PrintState, node: TSConstructorType): void {
  state.out += `${flagText(node.abstract, 'abstract ')}new ${typeParametersText(state, node.typeParameters)}(${
    paramsText(state, node.params)
  }) => ${printTSTypeToString(state, node.returnType.typeAnnotation)}`
}

function printTSTypePredicate(state: PrintState, node: TSTypePredicate): void {
  state.out += flagText(node.asserts, 'asserts ')
  state.out += typePredicateParameterText(node.parameterName)
  printPredicateAnnotation(state, node)
}

function printPredicateAnnotation(state: PrintState, node: TSTypePredicate): void {
  if (node.typeAnnotation === null) return
  printTypeClause(state, ' is ', node.typeAnnotation.typeAnnotation)
}

function printTSLiteralType(state: PrintState, literal: TSLiteralType['literal']): void {
  switch (literal.type) {
    case 'Literal':
      printLiteral(state, literal)
      return
    case 'TemplateLiteral':
      printTemplateLiteral(state, literal)
      return
    case 'UnaryExpression':
      printTSLiteralUnary(state, literal)
  }
}

function printTSLiteralUnary(state: PrintState, unary: UnaryExpression): void {
  state.out += unary.operator
  if (isLiteralNode(unary.argument)) printLiteral(state, unary.argument)
}

function printJSDocPostfixModifier(
  state: PrintState,
  node: JSDocNullableType | JSDocNonNullableType,
  marker: string,
): void {
  if (node.postfix) {
    doPrintTSType(state, node.typeAnnotation)
    state.out += marker
    return
  }
  state.out += marker
  doPrintTSType(state, node.typeAnnotation)
}

function printTSTypeAnnotation(state: PrintState, node: TSTypeAnnotation): void {
  state.out += ': '
  doPrintTSType(state, node.typeAnnotation)
}

function printTSTypeParameterDeclaration(state: PrintState, node: TSTypeParameterDeclaration): void {
  state.out += `<${node.params.map((param) => capture(state, () => printTSTypeParameter(state, param))).join(', ')}>`
}

function printTSTypeParameterInstantiation(state: PrintState, node: TSTypeParameterInstantiation): void {
  state.out += `<${node.params.map((param) => printTSTypeToString(state, param)).join(', ')}>`
}

function printTSTypeParameter(state: PrintState, node: TSTypeParameterDeclaration['params'][number]): void {
  state.out += typeParameterModifiersText(node)
  state.out += node.name.name
  printTypeClause(state, ' extends ', node.constraint)
  printTypeClause(state, ' = ', node.default)
}

const TS_TYPE_NODE_KINDS: Readonly<Record<string, true>> = {
  TSAnyKeyword: true,
  TSStringKeyword: true,
  TSBooleanKeyword: true,
  TSNumberKeyword: true,
  TSBigIntKeyword: true,
  TSSymbolKeyword: true,
  TSVoidKeyword: true,
  TSUndefinedKeyword: true,
  TSNullKeyword: true,
  TSNeverKeyword: true,
  TSUnknownKeyword: true,
  TSObjectKeyword: true,
  TSIntrinsicKeyword: true,
  TSThisType: true,
  TSTypeReference: true,
  TSUnionType: true,
  TSIntersectionType: true,
  TSArrayType: true,
  TSTypeLiteral: true,
  TSTupleType: true,
  TSNamedTupleMember: true,
  TSOptionalType: true,
  TSRestType: true,
  TSConditionalType: true,
  TSInferType: true,
  TSTypeQuery: true,
  TSImportType: true,
  TSTypeOperator: true,
  TSMappedType: true,
  TSTemplateLiteralType: true,
  TSFunctionType: true,
  TSConstructorType: true,
  TSTypePredicate: true,
  TSIndexedAccessType: true,
  TSLiteralType: true,
  TSParenthesizedType: true,
  TSJSDocNullableType: true,
  TSJSDocNonNullableType: true,
  TSJSDocUnknownType: true,
}

function isTSTypeNode(kind: string): boolean {
  return TS_TYPE_NODE_KINDS[kind] === true
}

function isTSType(node: Node): node is TSType {
  return isTSTypeNode(node.type)
}

function isNodeOfKind<T extends Node['type']>(node: Node, kind: T): node is Extract<Node, { type: T }> {
  return node.type === kind
}

const FUNCTION_KINDS: Readonly<Record<string, true>> = {
  FunctionDeclaration: true,
  FunctionExpression: true,
  TSDeclareFunction: true,
  TSEmptyBodyFunctionExpression: true,
}

function isFunctionNode(node: Node): node is FunctionNode {
  return FUNCTION_KINDS[node.type] === true
}

function isAssignmentPattern(node: Node): node is AssignmentPattern {
  return node.type === 'AssignmentPattern'
}

function isLiteralNode(node: Node): node is LiteralNode {
  return node.type === 'Literal'
}

const ABSENT_NODE_KIND = '\u0000absent'

function nodeKind(node: { readonly type: string } | null | undefined): string {
  if (node == null) return ABSENT_NODE_KIND
  return node.type
}

function isIdentifierNode(node: Node | null | undefined): node is Extract<Node, { type: 'Identifier' }> {
  if (node == null) return false
  return node.type === 'Identifier'
}

function isPrivateIdentifierNode(
  node: Node | null | undefined,
): node is Extract<Node, { type: 'PrivateIdentifier' }> {
  if (node == null) return false
  return node.type === 'PrivateIdentifier'
}

function isAssignmentPatternNode(node: Node | null | undefined): node is AssignmentPattern {
  if (node == null) return false
  return node.type === 'AssignmentPattern'
}

function identifierName(node: Node | null | undefined): string | undefined {
  if (isIdentifierNode(node)) return node.name
  return undefined
}

function identifierNameText(node: Node | null | undefined): string {
  return identifierName(node) ?? ''
}

function privateIdentifierText(node: Node | null | undefined): string {
  if (isPrivateIdentifierNode(node)) return `#${node.name}`
  return ''
}

function literalCapture(state: PrintState, node: Node): string {
  if (isLiteralNode(node)) return capture(state, () => printLiteral(state, node))
  return capture(state, () => printNodePrec(state, node, PREC.Assignment))
}

function precOf(node: Node): number {
  switch (nodeKind(node)) {
    case 'SequenceExpression':
      return PREC.Sequence
    case 'AssignmentExpression':
      return PREC.Assignment
    case 'ConditionalExpression':
      return PREC.Conditional
    case 'LogicalExpression':
      return logicalPrecOf(node)
    case 'BinaryExpression':
      return binaryPrecOf(node)
    case 'UnaryExpression':
    case 'AwaitExpression':
    case 'YieldExpression':
      return PREC.Unary
    case 'UpdateExpression':
      return PREC.Update
    case 'CallExpression':
    case 'NewExpression':
    case 'TaggedTemplateExpression':
    case 'ImportExpression':
      return PREC.Call
    case 'MemberExpression':
    case 'ChainExpression':
      return PREC.Member
    default:
      return PREC.Primary
  }
}

function logicalPrecOf(node: Node): number {
  if (node.type === 'LogicalExpression') return logicalPrec(node.operator)
  return PREC.Primary
}

function binaryPrecOf(node: Node): number {
  if (node.type === 'BinaryExpression') return binaryPrec(node.operator)
  return PREC.Primary
}

const EVERY_COMMENT_POSITION = Number.POSITIVE_INFINITY

const END_OF_COMMENTS: Comment = {
  type: 'Line',
  value: '',
  start: EVERY_COMMENT_POSITION,
  end: EVERY_COMMENT_POSITION,
}

function sortedCommentsWithoutHashbang(
  comments: readonly Comment[] | undefined,
  hashbang: Hashbang | null,
): readonly Comment[] {
  const list = comments ?? []
  return [...withoutHashbangComment(list, hashbang)].sort((a, b) => a.start - b.start)
}

function withoutHashbangComment(comments: readonly Comment[], hashbang: Hashbang | null): readonly Comment[] {
  if (hashbang === null) return comments
  const { start } = hashbang
  return comments.filter((comment) => !(comment.type === 'Line' && comment.start === start))
}

interface AttachedComment {
  readonly type: string
  readonly value: string
}

interface CommentHost {
  readonly type: string
  readonly leadingComments?: readonly AttachedComment[]
  readonly trailingComments?: readonly AttachedComment[]
}

const MEMBER_OBJECT_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  SequenceExpression: true,
  AssignmentExpression: true,
  ConditionalExpression: true,
  LogicalExpression: true,
  BinaryExpression: true,
  UnaryExpression: true,
  UpdateExpression: true,
  AwaitExpression: true,
  YieldExpression: true,
}

const CALLEE_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  SequenceExpression: true,
  ConditionalExpression: true,
}

const UNARY_OPERAND_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  BinaryExpression: true,
  LogicalExpression: true,
  ConditionalExpression: true,
  SequenceExpression: true,
}

const UNARY_WORD_OPERATORS: Readonly<Record<string, true>> = {
  typeof: true,
  void: true,
  delete: true,
}

const ARRAY_ELEMENT_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  TSUnionType: true,
  TSIntersectionType: true,
}

function parenthesizedIf(wrap: boolean, text: string): string {
  if (wrap) return `(${text})`
  return text
}

function jsxAttributeNameText(name: JSXAttribute['name']): string {
  if (name.type === 'JSXIdentifier') return name.name
  return `${name.namespace.name}:${name.name.name}`
}

interface PropertyLike {
  readonly type: 'Property'
  readonly kind?: string
  readonly method?: boolean
  readonly shorthand?: boolean
  readonly computed: boolean
  readonly key: Node
  readonly value: Node
}

interface BinaryLike {
  readonly left: Node
  readonly right: Node
  readonly operator: string
}

function propertyForm(fields: PropertyLike): string {
  if (isAccessorKind(fields)) return 'accessor'
  return propertyFormWithoutAccessor(fields)
}

function isAccessorKind(fields: PropertyLike): boolean {
  return fields.kind === 'get' || fields.kind === 'set'
}

function propertyFormWithoutAccessor(fields: PropertyLike): string {
  if (fields.method === true) return 'method'
  return propertyFormShorthand(fields)
}

function propertyFormShorthand(fields: PropertyLike): string {
  if (isShorthandMatch(fields)) return 'shorthand'
  return propertyFormDefault(fields)
}

function propertyFormDefault(fields: PropertyLike): string {
  if (isShorthandDefaultMatch(fields)) return 'shorthandDefault'
  return 'verbose'
}

function isShorthandMatch(fields: PropertyLike): boolean {
  return fields.shorthand === true && namesMatch(identifierName(fields.key), identifierName(fields.value))
}

function isShorthandDefaultMatch(fields: PropertyLike): boolean {
  return fields.shorthand === true && namesMatch(identifierName(fields.key), defaultTargetName(fields.value))
}

function defaultTargetName(node: Node | null | undefined): string | undefined {
  if (isAssignmentPatternNode(node)) return identifierName(node.left)
  return undefined
}

function namesMatch(key: string | undefined, value: string | undefined): boolean {
  if (value === undefined) return false
  return key === value
}

const BINDING_TYPE_ANNOTATION_KINDS: Readonly<Record<string, true>> = {
  Identifier: true,
  ObjectPattern: true,
  ArrayPattern: true,
}

function bindingTypeAnnotation(node: Node): TSTypeAnnotation | null | undefined {
  if (isBindingTypeAnnotationCarrier(node)) return node.typeAnnotation
  return undefined
}

function isBindingTypeAnnotationCarrier(
  node: Node,
): node is Extract<Node, { type: 'Identifier' | 'ObjectPattern' | 'ArrayPattern' }> {
  return BINDING_TYPE_ANNOTATION_KINDS[node.type] === true
}

function bindingNameText(node: { readonly name?: string }): string {
  if (node.name === undefined) return ''
  return node.name
}

interface ExportNameNode {
  readonly type: string
  readonly name?: string
  readonly value?: string
}

const EXPORT_NAME_TEXTS: Readonly<Record<string, (name: ExportNameNode) => string>> = {
  Identifier: (name) => name.name ?? '',
  Literal: (name) => name.value ?? '',
}

function exportNameToString(name: ExportNameNode): string {
  const reader = EXPORT_NAME_TEXTS[name.type] ?? ((exported: ExportNameNode) => exported.value ?? '')
  return reader(name)
}

function importKindText(node: ImportDeclaration): string {
  return flagText(node.importKind === 'type', 'type ')
}

interface ImportBinding {
  readonly type: string
  readonly local: { readonly name: string }
  readonly imported?: { readonly type: string; readonly name?: string; readonly value?: string }
  readonly importKind?: string
}

function importBindingsText(specifiers: readonly ImportBinding[]): string {
  const parts = [
    defaultSpecifierText(specifiers),
    namespaceSpecifierText(specifiers),
    namedSpecifiersText(specifiers),
  ]
  return parts.filter((text) => text.length > 0).join(', ')
}

function defaultSpecifierText(specifiers: readonly ImportBinding[]): string {
  return importLocalName(specifiers.find((specifier) => specifier.type === 'ImportDefaultSpecifier'))
}

function namespaceSpecifierText(specifiers: readonly ImportBinding[]): string {
  const name = importLocalName(specifiers.find((specifier) => specifier.type === 'ImportNamespaceSpecifier'))
  return flagText(name, `* as ${name}`)
}

function namedSpecifiersText(specifiers: readonly ImportBinding[]): string {
  const rendered = specifiers
    .filter((specifier) => specifier.type === 'ImportSpecifier')
    .map((specifier) => namedSpecifierText(specifier))
    .join(', ')
  return flagText(rendered, `{ ${rendered} }`)
}

function namedSpecifierText(specifier: ImportBinding): string {
  const alias = exportAliasText(importedNameText(specifier.imported), specifier.local.name)
  return `${flagText(specifier.importKind === 'type', 'type ')}${alias}`
}

function importLocalName(specifier: ImportBinding | undefined): string {
  if (specifier === undefined) return ''
  return specifier.local.name
}

function importedNameText(imported: ImportBinding['imported']): string {
  if (imported === undefined) return ''
  return importedNameOf(imported)
}

function importedNameOf(imported: NonNullable<ImportBinding['imported']>): string {
  if (imported.type === 'Identifier') return nameOrEmpty(imported.name)
  return nameOrEmpty(imported.value)
}

function nameOrEmpty(value: string | undefined): string {
  return value ?? ''
}

function exportAliasText(localName: string, exportedName: string): string {
  if (localName === exportedName) return localName
  return `${localName} as ${exportedName}`
}

function exportSpecifierText(specifier: {
  readonly local: ExportNameNode
  readonly exported: ExportNameNode
  readonly exportKind?: string
}): string {
  const alias = exportAliasText(exportNameToString(specifier.local), exportNameToString(specifier.exported))
  return `${flagText(specifier.exportKind === 'type', 'type ')}${alias}`
}

function exportedNameClauseText(exported: ExportNameNode | null | undefined): string {
  if (exported == null) return ''
  return ` as ${exportNameToString(exported)}`
}

function importAttributesText(attrs: readonly ImportAttribute[]): string {
  const rendered = attrs.map((attribute) => importAttributeText(attribute)).join(', ')
  return flagText(rendered, ` with { ${rendered} }`)
}

function importAttributeText(attribute: ImportAttribute): string {
  return `${importAttrKeyText(attribute.key)}: ${JSON.stringify(attribute.value.value)}`
}

function importAttrKeyText(key: ImportAttribute['key']): string {
  if (key.type === 'Identifier') return key.name
  return JSON.stringify(key.value)
}

function bareArrowParamName(node: ArrowFunctionExpression): string {
  const name = singleParamName(node)
  if (name === '') return ''
  return flagText(node.returnType == null, name)
}

function singleParamName(node: ArrowFunctionExpression): string {
  switch (node.params.length) {
    case 1:
      return bareParameterName(node.params[0])
    default:
      return ''
  }
}

function bareParameterName(param: ParamPattern | undefined): string {
  if (param === undefined) return ''
  return bareParameterNameOf(param)
}

function bareParameterNameOf(param: ParamPattern): string {
  if (!isUnannotatedIdentifier(param)) return ''
  return param.name
}

function isUnannotatedIdentifier(
  param: ParamPattern,
): param is Extract<ParamPattern, { readonly type: 'Identifier' }> {
  if (param.type !== 'Identifier') return false
  return param.typeAnnotation == null
}

function arrowBodyIsBlock(body: ArrowFunctionExpression['body']): body is Extract<Node, { type: 'BlockStatement' }> {
  return body.type === 'BlockStatement'
}

function functionHeaderText(node: FunctionNode): string {
  return `${flagText(node.declare, 'declare ')}${flagText(node.async, 'async ')}function${
    flagText(node.generator, '*')
  }${namedDeclarationText(node)}`
}

function namedDeclarationText(node: { readonly id?: { readonly name: string } | null }): string {
  if (node.id == null) return ''
  return ` ${node.id.name}`
}

function parameterPropertyModifiers(
  param: Extract<ParamPattern, { readonly type: 'TSParameterProperty' }>,
): string {
  return `${flagText(param.accessibility, `${param.accessibility} `)}${flagText(param.readonly, 'readonly ')}${
    flagText(param.override, 'override ')
  }${flagText(param.static, 'static ')}`
}

function commentText(comment: AttachedComment): string {
  if (comment.type === 'Block') return `/*${comment.value}*/`
  return `//${comment.value}`
}

function methodDefinitionPrefix(node: MethodDefinition, fn: FunctionNode): string {
  return `${flagText(node.accessibility, `${node.accessibility} `)}${flagText(node.static, 'static ')}${
    flagText(node.override, 'override ')
  }${flagText(fn.async, 'async ')}${flagText(fn.generator, '*')}${methodKindText(node.kind)}`
}

function methodKindText(kind: string): string {
  switch (kind) {
    case 'get':
      return 'get '
    case 'set':
      return 'set '
    default:
      return ''
  }
}

function propertyDefinitionModifiers(node: PropertyDefinition): string {
  return `${flagText(node.declare, 'declare ')}${flagText(node.accessibility, `${node.accessibility} `)}${
    flagText(node.static, 'static ')
  }${flagText(node.readonly, 'readonly ')}${flagText(node.override, 'override ')}`
}

type LiteralNode = Literal

type LiteralSource<A = unknown> = {
  readonly value: A
  readonly raw: string | null
  readonly bigint?: string
  readonly regex?: { readonly pattern: string; readonly flags: string }
}

function literalText(node: LiteralSource): string {
  if (node.raw != null) return node.raw
  return literalWithoutRaw(node)
}

function literalWithoutRaw(node: LiteralSource): string {
  if (node.regex != null) return `/${node.regex.pattern}/${node.regex.flags}`
  return literalWithoutRegex(node)
}

function literalWithoutRegex(node: LiteralSource): string {
  if (node.bigint != null) return node.bigint
  return valueLiteralText(node.value)
}

function valueLiteralText<A = unknown>(value: A): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  return nonStringLiteralText(value)
}

function nonStringLiteralText<A = unknown>(value: A): string {
  if (typeof value === 'number') {
    return String(value)
  }
  return booleanOrBigintText(value)
}

function booleanOrBigintText<A = unknown>(value: A): string {
  if (typeof value === 'boolean') {
    return String(value)
  }
  return bigintText(value)
}

function bigintText<A = unknown>(value: A): string {
  return typeof value === 'bigint' ? `${value}n` : 'null'
}

function flagText<A = unknown>(present: A, text: string): string {
  switch (Boolean(present)) {
    case true:
      return text
    case false:
      return ''
  }
}

function typeParameterModifiersText(node: TSTypeParameterDeclaration['params'][number]): string {
  return `${flagText(node.in, 'in ')}${flagText(node.out, 'out ')}${flagText(node.const, 'const ')}`
}

function typePredicateParameterText(parameterName: TSTypePredicate['parameterName']): string {
  if (parameterName.type === 'TSThisType') return 'this'
  return parameterName.name
}

function externalModuleArgumentText(value: string): string {
  switch (Boolean(value)) {
    case true:
      return JSON.stringify(value)
    case false:
      return '""'
  }
}

const BARE_DEFAULT_EXPORT_KINDS: Readonly<Record<string, true>> = {
  FunctionDeclaration: true,
  ClassDeclaration: true,
  TSInterfaceDeclaration: true,
}

function isBareDefaultExport(
  node: ExportDefaultDeclaration['declaration'],
): node is FunctionNode | Class | TSInterfaceDeclaration {
  return BARE_DEFAULT_EXPORT_KINDS[node.type] === true
}
