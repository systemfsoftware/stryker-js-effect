  statement: Program['body'][number],
): readonly [cursor: number, text: string] => {
  const [prefix, next] = pendingComments(comments, cursor, statement.start ?? -1)
  return [next, `${prefix}${statementText(ctx, statement)}\n`]
}

const pendingComments = (
  comments: readonly Comment[],
  cursor: number,
  pos: number,
): readonly [text: string, cursor: number] => {
  const end = Option.match(Arr.findFirstIndex(comments, (comment) => comment.start >= pos), {
    onSome: (index) => Math.max(cursor, index),
    onNone: () => comments.length,
  })
  return [comments.slice(cursor, end).map(emitComment).join(''), end]
}

const jumpStatementText = (keyword: string, label: LabelIdentifier | null): string =>
  Option.match(Option.fromNullishOr(label), {
    onSome: (value) => `${keyword} ${value.name};`,
    onNone: () => `${keyword};`,
  })

const emitComment = (comment: Comment): string =>
  Match.value(comment.type).pipe(
    Match.when('Line', () => `//${comment.value}\n`),
    Match.orElse(() => `/*${comment.value}*/\n`),
  )

const hashbangPrefix = (hashbang: Hashbang | null): string =>
  Option.match(Option.fromNullishOr(hashbang), {
    onNone: () => '',
    onSome: (value) => `#!${value.value}\n`,
  })

const statementText = (ctx: PrintContext, node: Statement): string =>
  `${attachedCommentsText(ctx, node, 'leadingComments')}${statementKindText(ctx, node)}${attachedCommentsText(
    ctx,
    node,
    'trailingComments',
  )}`

const attachedCommentsText = (
  ctx: PrintContext,
  node: CommentHost,
  field: 'leadingComments' | 'trailingComments',
): string =>
  Option.match(Option.fromNullishOr(node[field]), {
    onNone: () => '',
    onSome: (comments) => comments.map((comment) => attachedCommentText(ctx, comment, field)).join(''),
  })

const attachedCommentText = (
  ctx: PrintContext,
  comment: AttachedComment,
  field: 'leadingComments' | 'trailingComments',
): string =>
  Boolean.match(field === 'leadingComments', {
    onTrue: () => `${indent(ctx)}${commentText(comment)}\n`,
    onFalse: () => `${commentText(comment)} `,
  })

const indent = (ctx: PrintContext): string => '  '.repeat(ctx.indentLevel)

const needsParens = (childPrec: number, parentPrec: number, isRight: boolean, op?: string): boolean =>
  Boolean.match(childPrec === parentPrec, {
    onTrue: () => equalPrecedenceNeedsParens(isRight, op),
    onFalse: () => childPrec < parentPrec,
  })

const equalPrecedenceNeedsParens = (isRight: boolean, op?: string): boolean =>
  Boolean.match(op === '**', {
    onTrue: () => !isRight,
    onFalse: () => isRight,
  })

const wrapIfNeeded = (
  ctx: PrintContext,
  node: Node,
  prec: number,
  parentPrec: number,
  isRight: boolean,
  op?: string,
): string => parenthesizedIf(needsParens(prec, parentPrec, isRight, op), dispatchNode(ctx, node, prec))

const sequenceNodeText = (ctx: PrintContext, node: Node | null | undefined): string =>
  printNodePrec(ctx, node, PREC.Sequence)

const assignmentNodeText = (ctx: PrintContext, node: Node | null | undefined): string =>
  printNodePrec(ctx, node, PREC.Assignment)

const nodeListText = (ctx: PrintContext, nodes: readonly Node[], prec: number): string =>
  nodes.map((node) => dispatchNode(ctx, node, prec)).join(', ')

const wrappedExpressionText = (
  ctx: PrintContext,
  node: Node,
  prec: number,
  wrappedKinds: Readonly<Record<string, true>>,
): string => parenthesizedIf(wrappedKinds[node.type] === true, dispatchNode(ctx, node, prec))

const printNodePrec = (ctx: PrintContext, node: Node | null | undefined, prec: number): string =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => '',
    onSome: (value) => dispatchNode(ctx, value, prec),
  })

const isNode = <T extends Node['type']>(type: T) => (node: Node): node is Extract<Node, { type: T }> =>
  node.type === type

const dispatchNode = (ctx: PrintContext, node: Node, prec: number): string =>
  Match.value(node).pipe(
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.when(isNode('Identifier'), (n) => n.name),
    Match.when(isNode('PrivateIdentifier'), (n) => `#${n.name}`),
    Match.when(isNode('ThisExpression'), () => 'this'),
    Match.when(isNode('Super'), () => 'super'),
    Match.when(isNode('ArrayExpression'), (n) => arrayExpressionText(ctx, n)),
    Match.when(isNode('ObjectExpression'), (n) => objectExpressionText(ctx, n)),
    Match.when(isNode('Property'), (n) => propertyText(ctx, n)),
    Match.when(isNode('TemplateLiteral'), (n) => templateLiteralText(ctx, n)),
    Match.when(isNode('TemplateElement'), (n) => n.value.raw),
    Match.when(isNode('TaggedTemplateExpression'), (n) => taggedTemplateText(ctx, n)),
    Match.when(isNode('MemberExpression'), (n) => memberExpressionText(ctx, n)),
    Match.when(isNode('CallExpression'), (n) => callExpressionText(ctx, n)),
    Match.when(isNode('NewExpression'), (n) => newExpressionText(ctx, n)),
    Match.when(isNode('MetaProperty'), (n) => metaPropertyText(n)),
    Match.when(isNode('SpreadElement'), (n) => `...${printNodePrec(ctx, n.argument, PREC.Assignment)}`),
    Match.when(isNode('RestElement'), (n) => `...${printNodePrec(ctx, n.argument, PREC.Assignment)}`),
    Match.when(isNode('UpdateExpression'), (n) => updateExpressionText(ctx, n)),
    Match.when(isNode('UnaryExpression'), (n) => unaryExpressionText(ctx, n)),
    Match.when(isNode('BinaryExpression'), (n) => binaryExpressionText(ctx, n, prec)),
    Match.when(isNode('LogicalExpression'), (n) => logicalExpressionText(ctx, n, prec)),
    Match.when(isNode('ConditionalExpression'), (n) => conditionalExpressionText(ctx, n, prec)),
    Match.when(isNode('AssignmentExpression'), (n) => assignmentExpressionText(ctx, n, prec)),
    Match.when(isNode('AssignmentPattern'), (n) => assignmentPatternText(ctx, n, prec)),
    Match.when(isNode('ObjectPattern'), (n) => objectPatternText(ctx, n)),
    Match.when(isNode('ArrayPattern'), (n) => arrayPatternText(ctx, n)),
    Match.when(isNode('SequenceExpression'), (n) => sequenceExpressionText(ctx, n, prec)),
    Match.when(isNode('AwaitExpression'), (n) => `await ${printNodePrec(ctx, n.argument, PREC.Unary)}`),
    Match.when(isNode('YieldExpression'), (n) => yieldExpressionText(ctx, n)),
    Match.when(isNode('ChainExpression'), (n) => printNodePrec(ctx, n.expression, prec)),
    Match.when(isNode('ParenthesizedExpression'), (n) => `(${printNodePrec(ctx, n.expression, PREC.Sequence)})`,
    ),
    Match.when(isNode('ImportExpression'), (n) => importExpressionText(ctx, n)),
    Match.when(isNode('V8IntrinsicExpression'), (n) => v8IntrinsicText(ctx, n)),
    Match.when(isNode('ArrowFunctionExpression'), (n) => arrowFunctionText(ctx, n, prec)),
    Match.when(isNode('FunctionDeclaration'), (n) => functionText(ctx, n)),
    Match.when(isNode('FunctionExpression'), (n) => functionText(ctx, n)),
    Match.when(isNode('TSDeclareFunction'), (n) => functionText(ctx, n)),
    Match.when(isNode('TSEmptyBodyFunctionExpression'), (n) => functionText(ctx, n)),
    Match.when(isNode('ClassDeclaration'), (n) => classText(ctx, n)),
    Match.when(isNode('ClassExpression'), (n) => classText(ctx, n)),
    Match.when(isNode('JSXElement'), (n) => jsxElementText(ctx, n)),
    Match.when(isNode('JSXFragment'), (n) => jsxFragmentText(ctx, n)),
    Match.when(isNode('JSXOpeningElement'), (n) => jsxOpeningElementText(ctx, n)),
    Match.when(isNode('JSXClosingElement'), () => ''),
    Match.when(isNode('JSXIdentifier'), (n) => n.name),
    Match.when(isNode('JSXNamespacedName'), (n) => `${n.namespace.name}:${n.name.name}`),
    Match.when(isNode('JSXMemberExpression'), (n) => jsxMemberExpressionText(n)),
    Match.when(isNode('JSXAttribute'), (n) => jsxAttributeText(ctx, n)),
    Match.when(isNode('JSXSpreadAttribute'), (n) => `{...${printNodePrec(ctx, n.argument, PREC.Assignment)}}`,
    ),
    Match.when(isNode('JSXExpressionContainer'), (n) => `{${printNodePrec(ctx, n.expression, PREC.Sequence)}}`,
    ),
    Match.when(isNode('JSXEmptyExpression'), () => ''),
    Match.when(isNode('JSXText'), (n) => n.value),
    Match.when(isNode('JSXSpreadChild'), (n) => `{...${printNodePrec(ctx, n.expression, PREC.Assignment)}}`),
    Match.when(isNode('TSAsExpression'), (n) => tsAsExpressionText(ctx, n, prec)),
    Match.when(isNode('TSSatisfiesExpression'), (n) => tsSatisfiesExpressionText(ctx, n, prec)),
    Match.when(isNode('TSTypeAssertion'), (n) => tsTypeAssertionText(ctx, n)),
    Match.when(isNode('TSNonNullExpression'), (n) => `${printNodePrec(ctx, n.expression, PREC.Member)}!`),
    Match.when(isNode('TSInstantiationExpression'), (n) => tsInstantiationExpressionText(ctx, n)),
    Match.when(isNode('BlockStatement'), (n) => blockStatementText(ctx, n)),
    Match.when(isNode('EmptyStatement'), () => ';'),
    Match.when(isNode('ExpressionStatement'), (n) => expressionStatementText(ctx, n)),
    Match.when(isNode('IfStatement'), (n) => ifStatementText(ctx, n)),
    Match.when(isNode('DoWhileStatement'), (n) => doWhileStatementText(ctx, n)),
    Match.when(isNode('WhileStatement'), (n) => whileStatementText(ctx, n)),
    Match.when(isNode('ForStatement'), (n) => forStatementText(ctx, n)),
    Match.when(isNode('ForInStatement'), (n) => forInStatementText(ctx, n)),
    Match.when(isNode('ForOfStatement'), (n) => forOfStatementText(ctx, n)),
    Match.when(isNode('ContinueStatement'), (n) => jumpStatementText('continue', n.label)),
    Match.when(isNode('BreakStatement'), (n) => jumpStatementText('break', n.label)),
    Match.when(isNode('ReturnStatement'), (n) => returnStatementText(ctx, n)),
    Match.when(isNode('WithStatement'), (n) => withStatementText(ctx, n)),
    Match.when(isNode('SwitchStatement'), (n) => switchStatementText(ctx, n)),
    Match.when(isNode('SwitchCase'), () => ''),
    Match.when(isNode('LabeledStatement'), (n) => labeledStatementText(ctx, n)),
    Match.when(isNode('ThrowStatement'), (n) => `throw ${printNodePrec(ctx, n.argument, PREC.Sequence)};`),
    Match.when(isNode('TryStatement'), (n) => tryStatementText(ctx, n)),
    Match.when(isNode('CatchClause'), () => ''),
    Match.when(isNode('DebuggerStatement'), () => 'debugger;'),
    Match.when(isNode('VariableDeclaration'), (n) => variableDeclarationText(ctx, n)),
    Match.when(isNode('VariableDeclarator'), (n) => variableDeclaratorText(ctx, n)),
    Match.when(isNode('ClassBody'), (n) => classBodyText(ctx, n)),
    Match.when(isNode('MethodDefinition'), (n) => methodDefinitionText(ctx, n)),
    Match.when(isNode('TSAbstractMethodDefinition'), (n) => methodDefinitionText(ctx, n)),
    Match.when(isNode('PropertyDefinition'), (n) => propertyDefinitionText(ctx, n)),
    Match.when(isNode('TSAbstractPropertyDefinition'), (n) => propertyDefinitionText(ctx, n)),
    Match.when(isNode('AccessorProperty'), (n) => accessorPropertyText(ctx, n)),
    Match.when(isNode('TSAbstractAccessorProperty'), (n) => accessorPropertyText(ctx, n)),
    Match.when(isNode('StaticBlock'), (n) => staticBlockText(ctx, n)),
    Match.when(isNode('ImportDeclaration'), (n) => importDeclarationText(ctx, n)),
    Match.when(isNode('ExportNamedDeclaration'), (n) => exportNamedDeclarationText(ctx, n)),
    Match.when(isNode('ExportDefaultDeclaration'), (n) => exportDefaultDeclarationText(ctx, n)),
    Match.when(isNode('ExportAllDeclaration'), (n) => exportAllDeclarationText(ctx, n)),
    Match.when(isNode('Decorator'), (n) => `@${printNodePrec(ctx, n.expression, PREC.Member)}`),
    Match.when(isNode('TSTypeAliasDeclaration'), (n) => tsTypeAliasDeclarationText(ctx, n)),
    Match.when(isNode('TSInterfaceDeclaration'), (n) => tsInterfaceDeclarationText(ctx, n)),
    Match.when(isNode('TSEnumDeclaration'), (n) => tsEnumDeclarationText(ctx, n)),
    Match.when(isNode('TSModuleDeclaration'), (n) => tsModuleDeclarationText(ctx, n)),
    Match.when(isNode('TSImportEqualsDeclaration'), (n) => tsImportEqualsDeclarationText(ctx, n)),
    Match.when(isNode('TSExportAssignment'), (n) => `export = ${printNodePrec(ctx, n.expression, PREC.Sequence)};`,
    ),
    Match.when(isNode('TSNamespaceExportDeclaration'), (n) => `export as namespace ${n.id.name};`),
    Match.when(isNode('TSTypeAnnotation'), (n) => `: ${printTSTypeToString(ctx, n.typeAnnotation)}`),
    Match.when(isNode('TSTypeParameterDeclaration'), (n) => printTSTypeParameterDeclaration(ctx, n)),
    Match.when(isNode('TSTypeParameterInstantiation'), (n) => printTSTypeParameterInstantiation(ctx, n)),
    Match.when(isNode('TSTypeParameter'), (n) => printTSTypeParameter(ctx, n)),
    Match.when(isTSType, (n) => printTSTypeToString(ctx, n)),
    Match.orElse((n) => `/* unknown:${n.type} */`),
  )

const statementKindText = (ctx: PrintContext, node: Statement): string =>
  Match.value(node).pipe(
    Match.when(isNode('BlockStatement'), (n) => blockStatementText(ctx, n)),
    Match.when(isNode('VariableDeclaration'), (n) => `${variableDeclarationText(ctx, n)};`),
    Match.when(isNode('FunctionDeclaration'), (n) => functionText(ctx, n)),
    Match.when(isNode('FunctionExpression'), (n) => functionText(ctx, n)),
    Match.when(isNode('TSDeclareFunction'), (n) => functionText(ctx, n)),
    Match.when(isNode('TSEmptyBodyFunctionExpression'), (n) => functionText(ctx, n)),
    Match.when(isNode('ClassDeclaration'), (n) => classText(ctx, n)),
    Match.when(isNode('ClassExpression'), (n) => classText(ctx, n)),
    Match.when(isNode('ExpressionStatement'), (n) => expressionStatementText(ctx, n)),
    Match.when(isNode('IfStatement'), (n) => ifStatementText(ctx, n)),
    Match.when(isNode('ForStatement'), (n) => forStatementText(ctx, n)),
    Match.when(isNode('ForInStatement'), (n) => forInStatementText(ctx, n)),
    Match.when(isNode('ForOfStatement'), (n) => forOfStatementText(ctx, n)),
    Match.when(isNode('WhileStatement'), (n) => whileStatementText(ctx, n)),
    Match.when(isNode('DoWhileStatement'), (n) => doWhileStatementText(ctx, n)),
    Match.when(isNode('ReturnStatement'), (n) => returnStatementText(ctx, n)),