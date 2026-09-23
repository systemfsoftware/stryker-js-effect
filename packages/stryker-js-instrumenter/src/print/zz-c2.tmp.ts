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
    Match.when(isNode('ThrowStatement'), (n) => `throw ${printNodePrec(ctx, n.argument, PREC.Sequence)};`),
    Match.when(isNode('TryStatement'), (n) => tryStatementText(ctx, n)),
    Match.when(isNode('SwitchStatement'), (n) => switchStatementText(ctx, n)),
    Match.when(isNode('LabeledStatement'), (n) => labeledStatementText(ctx, n)),
    Match.when(isNode('BreakStatement'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('ContinueStatement'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('DebuggerStatement'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('EmptyStatement'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('WithStatement'), (n) => withStatementText(ctx, n)),
    Match.when(isNode('ImportDeclaration'), (n) => importDeclarationText(ctx, n)),
    Match.when(isNode('ExportNamedDeclaration'), (n) => exportNamedDeclarationText(ctx, n)),
    Match.when(isNode('ExportDefaultDeclaration'), (n) => exportDefaultDeclarationText(ctx, n)),
    Match.when(isNode('ExportAllDeclaration'), (n) => exportAllDeclarationText(ctx, n)),
    Match.when(isNode('TSTypeAliasDeclaration'), (n) => tsTypeAliasDeclarationText(ctx, n)),
    Match.when(isNode('TSInterfaceDeclaration'), (n) => tsInterfaceDeclarationText(ctx, n)),
    Match.when(isNode('TSEnumDeclaration'), (n) => tsEnumDeclarationText(ctx, n)),
    Match.when(isNode('TSModuleDeclaration'), (n) => tsModuleDeclarationText(ctx, n)),
    Match.when(isNode('TSImportEqualsDeclaration'), (n) => tsImportEqualsDeclarationText(ctx, n)),
    Match.when(isNode('TSExportAssignment'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('TSNamespaceExportDeclaration'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.orElse(() => ''),
  )

const literalText = <A = unknown>(node: LiteralSource<A>): string => node.raw ?? literalWithoutRaw(node)

const literalWithoutRaw = <A = unknown>(node: LiteralSource<A>): string =>
  Option.match(Option.fromNullishOr(node.regex), {
    onSome: (regex) => `/${regex.pattern}/${regex.flags}`,
    onNone: () => literalWithoutRegex(node),
  })

const literalWithoutRegex = <A = unknown>(node: LiteralSource<A>): string =>
  Option.match(Option.fromNullishOr(node.bigint), {
    onSome: (bigint) => bigint,
    onNone: () => valueLiteralText(node.value),
  })

const valueLiteralText = <A = unknown>(value: A): string =>
  Match.value(value).pipe(
    Match.when(Match.string, (v) => JSON.stringify(v)),
    Match.orElse(nonStringLiteralText),
  )

const nonStringLiteralText = <A = unknown>(value: A): string =>
  Match.value(value).pipe(
    Match.when(Match.number, (v) => String(v)),
    Match.orElse(booleanOrBigintText),
  )

const booleanOrBigintText = <A = unknown>(value: A): string =>
  Match.value(value).pipe(
    Match.when(Match.boolean, (v) => String(v)),
    Match.orElse(bigintText),
  )

const bigintText = <A = unknown>(value: A): string =>
  Match.value(value).pipe(
    Match.when((candidate): candidate is bigint => typeof candidate === 'bigint', (v) => `${v}n`),
    Match.orElse(() => 'null'),
  )

const flagText = <A = unknown>(present: A, text: string): string =>
  Boolean.match(Predicate.isTruthy(present), {
    onTrue: () => text,
    onFalse: () => '',
  })

const parenthesizedIf = (wrap: boolean, text: string): string =>
  Boolean.match(wrap, {
    onTrue: () => `(${text})`,
    onFalse: () => text,
  })

const arrayExpressionText = (ctx: PrintContext, node: ArrayExpression): string =>
  `[${node.elements.map((element) => printNodePrec(ctx, element, PREC.Assignment)).join(', ')}]`

const objectExpressionText = (ctx: PrintContext, node: ObjectExpression): string =>
  Boolean.match(node.properties.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{ ${nodeListText(ctx, node.properties, PREC.Sequence)} }`,
  })

type PropertyForm = 'accessor' | 'method' | 'shorthand' | 'shorthandDefault' | 'verbose'

const propertyText = (ctx: PrintContext, node: PropertyLike): string =>
  Match.value(propertyFormOf(node)).pipe(
    Match.when('accessor', () => `${node.kind} ${propertyKeyText(ctx, node.key, node.computed === true, PREC.Assignment)}${functionValueTailText(ctx, node.value)}`),
    Match.when('method', () => `${propertyKeyText(ctx, node.key, node.computed === true, PREC.Assignment)}${functionValueTailText(ctx, node.value)}`),
    Match.when('shorthand', () => identifierNameText(node.key)),
    Match.when('shorthandDefault', () => shorthandDefaultPropertyText(ctx, node)),
    Match.orElse(
      () => `${propertyKeyText(ctx, node.key, node.computed === true, PREC.Assignment)}: ${printNodePrec(ctx, node.value, PREC.Assignment)}`,
    ),
  )

const functionValueTailText = (ctx: PrintContext, value: Node): string =>
  Match.value(value).pipe(
    Match.when(isFunctionNode, (fn) => functionTailText(ctx, fn)),
    Match.orElse(() => ''),
  )

const shorthandDefaultPropertyText = (ctx: PrintContext, node: PropertyLike): string =>
  Match.value(node.value).pipe(
    Match.when(
      isAssignmentPattern,
      (value) => `${identifierNameText(node.key)} = ${printNodePrec(ctx, value.right, PREC.Assignment)}`,
    ),
    Match.orElse(() => ''),
  )

const propertyKeyText = (ctx: PrintContext, key: Node, computed: boolean, computedPrec: number): string =>
  Boolean.match(computed, {
    onTrue: () => `[${dispatchNode(ctx, key, computedPrec)}]`,
    onFalse: () => plainPropertyKeyText(ctx, key),
  })

const plainPropertyKeyText = (ctx: PrintContext, key: Node): string =>
  Match.value(key).pipe(
    Match.when(isNode('Identifier'), (n) => identifierNameText(n)),
    Match.when(isNode('PrivateIdentifier'), (n) => privateIdentifierText(n)),
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.orElse((n) => dispatchNode(ctx, n, PREC.Assignment)),
  )

const functionTailText = (ctx: PrintContext, fn: FunctionNode): string =>
  `${typeParametersText(ctx, fn.typeParameters)}(${paramsText(ctx, fn.params)})${typeAnnotationText(
    ctx,
    fn.returnType,
  )}${functionBodyText(ctx, fn)}`

const functionBodyText = (ctx: PrintContext, fn: FunctionNode): string =>
  Option.match(Option.fromNullishOr(fn.body), {
    onSome: (body) => ` ${blockStatementText(ctx, body)}`,
    onNone: () => ';',
  })

const paramsText = (ctx: PrintContext, params: readonly ParamPattern[]): string =>
  params.map((param) => paramText(ctx, param)).join(', ')

const typeParametersText = (ctx: PrintContext, params: TSTypeParameterDeclaration | null | undefined): string =>
  Option.match(Option.fromNullishOr(params), {
    onNone: () => '',
    onSome: (value) => printTSTypeParameterDeclaration(ctx, value),
  })

const typeArgumentsText = (ctx: PrintContext, args: TSTypeParameterInstantiation | null | undefined): string =>
  Option.match(Option.fromNullishOr(args), {
    onNone: () => '',
    onSome: (value) => printTSTypeParameterInstantiation(ctx, value),
  })

const typeAnnotationText = (ctx: PrintContext, annotation: TSTypeAnnotation | null | undefined): string =>
  Option.match(Option.fromNullishOr(annotation), {
    onNone: () => '',
    onSome: (value) => printTSTypeAnnotation(ctx, value),
  })

const templateLiteralText = (ctx: PrintContext, node: TemplateLiteral): string =>
  `\`${node.quasis
    .map((quasi, index) => quasiText(ctx, quasi, node.expressions[index]))
    .join('')}\``

const quasiText = (ctx: PrintContext, quasi: TemplateElement, expression: Expression | undefined): string =>
  Boolean.match(quasi.tail, {
    onTrue: () => quasi.value.raw,
    onFalse: () => `${quasi.value.raw}\${${sequenceNodeText(ctx, expression)}}`,
  })

const taggedTemplateText = (ctx: PrintContext, node: TaggedTemplateExpression): string =>
  `${printNodePrec(ctx, node.tag, PREC.Member)}${typeArgumentsText(ctx, node.typeArguments)}${templateLiteralText(
    ctx,
    node.quasi,
  )}`

const memberExpressionText = (ctx: PrintContext, node: MemberExpression): string =>
  `${wrappedExpressionText(ctx, node.object, PREC.Member, MEMBER_OBJECT_WRAPPED_KINDS)}${flagText(
    node.optional,
    '?.',
  )}${memberSelectorText(ctx, node)}`

const memberSelectorText = (ctx: PrintContext, access: MemberExpression): string =>
  Boolean.match(access.computed, {
    onTrue: () => `[${sequenceNodeText(ctx, access.property)}]`,
    onFalse: () => `${flagText(!access.optional, '.')}${memberPropertyText(ctx, access.property)}`,
  })

const memberPropertyText = (ctx: PrintContext, property: Node): string =>
  Match.value(property).pipe(
    Match.when(isNode('Identifier'), (n) => identifierNameText(n)),
    Match.when(isNode('PrivateIdentifier'), (n) => privateIdentifierText(n)),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const callExpressionText = (ctx: PrintContext, node: CallExpression): string =>
  `${wrappedExpressionText(ctx, node.callee, PREC.Member, CALLEE_WRAPPED_KINDS)}${flagText(
    node.optional,
    '?.',
  )}${typeArgumentsText(ctx, node.typeArguments)}(${nodeListText(ctx, node.arguments, PREC.Assignment)})`

const newExpressionText = (ctx: PrintContext, node: NewExpression): string =>
  `new ${dispatchNode(ctx, node.callee, PREC.Member)}${typeArgumentsText(ctx, node.typeArguments)}(${nodeListText(
    ctx,
    node.arguments,
    PREC.Assignment,
  )})`

const metaPropertyText = (node: MetaProperty): string => `${node.meta.name}.${node.property.name}`

const v8IntrinsicText = (
  ctx: PrintContext,
  node: { readonly name: { readonly name: string }; readonly arguments: readonly Node[] },
): string => `%${node.name.name}(${nodeListText(ctx, node.arguments, PREC.Assignment)})`

const importExpressionText = (ctx: PrintContext, node: ImportExpression): string =>
  `import${flagText(node.phase, `.${node.phase}`)}(${assignmentNodeText(ctx, node.source)}${flagText(
    node.options,
    `, ${assignmentNodeText(ctx, node.options)}`,
  )})`

const updateExpressionText = (ctx: PrintContext, node: UpdateExpression): string => {
  const operand = wrappedExpressionText(ctx, node.argument, PREC.Update, MEMBER_OBJECT_WRAPPED_KINDS)
  return Boolean.match(node.prefix, {
    onTrue: () => `${node.operator}${operand}`,
    onFalse: () => `${operand}${node.operator}`,
  })
}

const unaryExpressionText = (ctx: PrintContext, node: UnaryExpression): string =>
  `${node.operator}${flagText(UNARY_WORD_OPERATORS[node.operator] === true, ' ')}${wrappedExpressionText(
    ctx,
    node.argument,
    PREC.Unary,
    UNARY_OPERAND_WRAPPED_KINDS,
  )}`

const binaryExpressionText = (ctx: PrintContext, node: BinaryLike, prec: number): string => {
  const myPrec = binaryPrec(node.operator)
  const leftStr = wrapIfNeeded(ctx, node.left, precOf(node.left), myPrec, false, node.operator)
  const rightStr = wrapIfNeeded(ctx, node.right, precOf(node.right), myPrec, true, node.operator)
  return parenthesizedIf(myPrec < prec, `${leftStr} ${node.operator} ${rightStr}`)
}

const logicalExpressionText = (ctx: PrintContext, node: LogicalExpression, prec: number): string => {
  const myPrec = logicalPrec(node.operator)
  const leftStr = wrapIfNeeded(ctx, node.left, precOf(node.left), myPrec, false, node.operator)
  const rightStr = wrapIfNeeded(ctx, node.right, precOf(node.right), myPrec, true, node.operator)
  return parenthesizedIf(myPrec < prec, `${leftStr} ${node.operator} ${rightStr}`)
}

const conditionalExpressionText = (ctx: PrintContext, node: ConditionalExpression, prec: number): string => {
  const myPrec = PREC.Conditional
  const testStr = wrapIfNeeded(ctx, node.test, precOf(node.test), myPrec, false)
  const consStr = dispatchNode(ctx, node.consequent, PREC.Assignment)
  const altStr = dispatchNode(ctx, node.alternate, PREC.Assignment)
  return parenthesizedIf(myPrec < prec, `${testStr} ? ${consStr} : ${altStr}`)
}

const assignmentExpressionText = (ctx: PrintContext, node: AssignmentExpression, prec: number): string => {
  const myPrec = PREC.Assignment
  const leftStr = dispatchNode(ctx, node.left, myPrec)
  const rightStr = dispatchNode(ctx, node.right, myPrec - 0.1)
  return parenthesizedIf(myPrec < prec, `${leftStr} ${node.operator} ${rightStr}`)
}

const assignmentPatternText = (
  ctx: PrintContext,
  node: Extract<Node, { type: 'AssignmentPattern' }>,
  prec: number,
): string =>
  parenthesizedIf(
    PREC.Assignment < prec,
    `${dispatchNode(ctx, node.left, PREC.Assignment)}${typeAnnotationText(ctx, bindingTypeAnnotation(node.left))} = ${dispatchNode(ctx, node.right, PREC.Assignment)}`,
  )

const objectPatternText = (ctx: PrintContext, node: { readonly properties: readonly Node[] }): string =>
  Boolean.match(node.properties.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{ ${nodeListText(ctx, node.properties, PREC.Sequence)} }`,
  })

const arrayPatternText = (ctx: PrintContext, node: Extract<Node, { type: 'ArrayPattern' }>): string =>
  `[${node.elements.map((element) => printNodePrec(ctx, element, PREC.Assignment)).join(', ')}]`

const sequenceExpressionText = (ctx: PrintContext, node: SequenceExpression, prec: number): string =>
  parenthesizedIf(
    PREC.Sequence < prec,
    node.expressions.map((expression) => dispatchNode(ctx, expression, PREC.Sequence)).join(', '),
  )

const yieldExpressionText = (ctx: PrintContext, node: YieldExpression): string =>
  `${Boolean.match(node.delegate, {
    onTrue: () => 'yield*',
    onFalse: () => 'yield',
  })}${flagText(node.argument, ` ${assignmentNodeText(ctx, node.argument)}`)}`

const arrowFunctionText = (ctx: PrintContext, node: ArrowFunctionExpression, prec: number): string =>
  parenthesizedIf(
    PREC.Assignment < prec,
    `${flagText(node.async, 'async ')}${typeParametersText(ctx, node.typeParameters)}${arrowParamsText(
      ctx,
      node,
    )}${typeAnnotationText(ctx, node.returnType)} => ${arrowBodyText(ctx, node)}`,
  )

const arrowParamsText = (ctx: PrintContext, node: ArrowFunctionExpression): string => {
  const bareParam = bareArrowParamName(node)
  return Boolean.match(bareParam.length === 0, {
    onTrue: () => `(${paramsText(ctx, node.params)})`,
    onFalse: () => bareParam,
  })
}

const arrowBodyText = (ctx: PrintContext, node: ArrowFunctionExpression): string =>
  Match.value(node.body).pipe(
    Match.when(isNode('BlockStatement'), (body) => blockStatementText(ctx, body)),
    Match.orElse((body) => assignmentNodeText(ctx, body)),
  )

const functionText = (ctx: PrintContext, node: FunctionNode): string =>
  `${functionHeaderText(node)}${functionTailText(ctx, node)}`

const classText = (ctx: PrintContext, node: Class): string =>
  `${decoratorsText(ctx, node.decorators)}${flagText(node.declare, 'declare ')}${flagText(
    node.abstract,
    'abstract ',
  )}class${namedDeclarationText(node)}${typeParametersText(ctx, node.typeParameters)}${classHeritageText(
    ctx,
    node,
  )}${classImplementsText(ctx, node)} ${classBodyText(ctx, node.body)}`

const classHeritageText = (ctx: PrintContext, node: Class): string =>
  Option.match(Option.fromNullishOr(node.superClass), {
    onSome: (superClass) =>
      ` extends ${assignmentNodeText(ctx, superClass)}${typeArgumentsText(ctx, node.superTypeArguments)}`,
    onNone: () => '',
  })

const classImplementsText = (ctx: PrintContext, node: Class): string => {
  const rendered = (node.implements ?? []).map((heritage) => heritageText(ctx, heritage)).join(', ')
  return flagText(rendered, ` implements ${rendered}`)
}

const heritageText = (
  ctx: PrintContext,
  heritage: {
    readonly expression: Node
    readonly typeArguments?: TSTypeParameterInstantiation | null
  },
): string => `${assignmentNodeText(ctx, heritage.expression)}${typeArgumentsText(ctx, heritage.typeArguments)}`

const decoratorsText = (ctx: PrintContext, decorators: readonly Decorator[] | undefined): string => {
  const rendered = (decorators ?? []).map((decorator) => decoratorText(ctx, decorator)).join(' ')
  return flagText(rendered, `${rendered} `)
}

const decoratorText = (ctx: PrintContext, decorator: Decorator): string =>
  `@${dispatchNode(ctx, decorator.expression, PREC.Member)}`

const jsxElementText = (ctx: PrintContext, node: JSXElement): string =>
  `${jsxOpeningElementText(ctx, node.openingElement)}${node.children
    .map((child) => jsxChildText(ctx, child))
    .join('')}${jsxClosingElementText(ctx, node)}`

const jsxClosingElementText = (ctx: PrintContext, node: JSXElement): string =>
  Option.match(Option.fromNullishOr(node.closingElement), {
    onSome: (closingElement) => `</${jsxElementNameText(ctx, closingElement.name)}>`,
    onNone: () => '',
  })

const jsxFragmentText = (ctx: PrintContext, node: JSXFragment): string =>
  `<>${node.children.map((child) => jsxChildText(ctx, child)).join('')}</>`

const jsxOpeningElementText = (ctx: PrintContext, node: JSXOpeningElement): string =>
  `<${jsxElementNameText(ctx, node.name)}${typeArgumentsText(ctx, node.typeArguments)}${node.attributes
    .map((attribute) => ` ${sequenceNodeText(ctx, attribute)}`)
    .join('')}${Boolean.match(node.selfClosing, {
    onTrue: () => ' />',
    onFalse: () => '>',
  })}`

const jsxElementNameText = (ctx: PrintContext, name: JSXOpeningElement['name']): string =>
  Match.value(name).pipe(
    Match.when(isNode('JSXIdentifier'), (n) => n.name),
    Match.when(isNode('JSXNamespacedName'), (n) => `${n.namespace.name}:${n.name.name}`),
    Match.when(isNode('JSXMemberExpression'), (n) => jsxMemberExpressionText(n)),
    Match.orElse(() => ''),
  )

const jsxMemberExpressionText = (node: JSXMemberExpression): string =>
  Match.value(node.object).pipe(
    Match.when(isNode('JSXIdentifier'), (obj) => `${obj.name}.${node.property.name}`),
    Match.orElse((obj) => `${jsxMemberExpressionText(obj)}.${node.property.name}`),
  )

const jsxAttributeText = (ctx: PrintContext, node: JSXAttribute): string =>
  `${jsxAttributeNameText(node.name)}${jsxAttributeValueClauseText(ctx, node.value)}`

const jsxAttributeValueClauseText = (ctx: PrintContext, value: JSXAttribute['value']): string =>
  Option.match(Option.fromNullishOr(value), {
    onSome: (nonNull) => `=${jsxAttributeValueText(ctx, nonNull)}`,
    onNone: () => '',
  })

const jsxAttributeValueText = (ctx: PrintContext, value: NonNullable<JSXAttribute['value']>): string =>
  Match.value(value).pipe(
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.when(isNode('JSXExpressionContainer'), (n) => `{${sequenceNodeText(ctx, n.expression)}}`),
    Match.when(isNode('JSXElement'), (n) => sequenceNodeText(ctx, n)),
    Match.when(isNode('JSXFragment'), (n) => sequenceNodeText(ctx, n)),
    Match.orElse(() => ''),
  )

const jsxChildText = (ctx: PrintContext, child: JSXElement['children'][number]): string =>
  Match.value(child).pipe(
    Match.when(isNode('JSXText'), (n) => n.value),
    Match.when(isNode('JSXElement'), (n) => jsxElementText(ctx, n)),
    Match.when(isNode('JSXFragment'), (n) => jsxFragmentText(ctx, n)),
    Match.when(isNode('JSXExpressionContainer'), (n) => `{${printNodePrec(ctx, n.expression, PREC.Sequence)}}`,
    ),
    Match.when(isNode('JSXSpreadChild'), (n) => `{...${printNodePrec(ctx, n.expression, PREC.Assignment)}}`),
    Match.orElse(() => ''),
  )

const tsAsExpressionText = (ctx: PrintContext, node: TSAsExpression, prec: number): string => {
  const myPrec = PREC.Relational
  return parenthesizedIf(
    myPrec < prec,
    `${dispatchNode(ctx, node.expression, myPrec)} as ${printTSTypeToString(ctx, node.typeAnnotation)}`,
  )
}

const tsSatisfiesExpressionText = (ctx: PrintContext, node: TSSatisfiesExpression, prec: number): string => {
  const myPrec = PREC.Relational
  return parenthesizedIf(
    myPrec < prec,
    `${dispatchNode(ctx, node.expression, myPrec)} satisfies ${printTSTypeToString(ctx, node.typeAnnotation)}`,
  )
}

const tsTypeAssertionText = (ctx: PrintContext, node: TSTypeAssertion): string =>
  `<${printTSTypeToString(ctx, node.typeAnnotation)}>${printNodePrec(ctx, node.expression, PREC.Unary)}`

const tsInstantiationExpressionText = (ctx: PrintContext, node: TSInstantiationExpression): string =>
  `${printNodePrec(ctx, node.expression, PREC.Member)}${printTSTypeParameterInstantiation(ctx, node.typeArguments)}`

const blockStatementText = (ctx: PrintContext, node: Extract<Node, { type: 'BlockStatement' }>): string =>
  Boolean.match(node.body.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{\n${indentedBodyText(ctx, node.body, statementText)}${indent(ctx)}}`,
  })

const expressionStatementText = (ctx: PrintContext, node: ExpressionStatement): string =>
  Boolean.match(isDirective(node.directive), {
    onTrue: () => `${JSON.stringify(node.directive)};`,
    onFalse: () => `${printNodePrec(ctx, node.expression, PREC.Sequence)};`,
  })

const isDirective = (directive: string | null | undefined): boolean =>
  directive != null && directive !== ''

const ifStatementText = (ctx: PrintContext, node: IfStatement): string =>
  `if (${printNodePrec(ctx, node.test, PREC.Sequence)}) ${statementOrBlockText(ctx, node.consequent)}${Option.match(
    Option.fromNullishOr(node.alternate),
    {
      onSome: (alternate) => ` else ${statementOrBlockText(ctx, alternate)}`,
      onNone: () => '',
    },
  )}`

const statementOrBlockText = (ctx: PrintContext, node: Statement): string =>
  Match.value(node).pipe(
    Match.when(isNode('BlockStatement'), (n) => blockStatementText(ctx, n)),
    Match.orElse((n) => statementText(ctx, n)),
  )

const whileStatementText = (ctx: PrintContext, node: WhileStatement): string =>
  `while (${printNodePrec(ctx, node.test, PREC.Sequence)}) ${statementOrBlockText(ctx, node.body)}`

const doWhileStatementText = (ctx: PrintContext, node: DoWhileStatement): string =>
  `do ${statementOrBlockText(ctx, node.body)} while (${printNodePrec(ctx, node.test, PREC.Sequence)});`

const forStatementText = (ctx: PrintContext, node: ForStatement): string =>
  `for (${declarationOrExpressionText(ctx, node.init)}; ${optionalSequenceText(ctx, node.test)}; ${optionalSequenceText(
    ctx,
    node.update,
  )}) ${statementOrBlockText(ctx, node.body)}`

const declarationOrExpressionText = (ctx: PrintContext, node: Node | null | undefined): string =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => '',
    onSome: (value) =>
      Match.value(value).pipe(
        Match.when(isNode('VariableDeclaration'), (n) => variableDeclarationText(ctx, n)),
        Match.orElse((n) => printNodePrec(ctx, n, PREC.Sequence)),
      ),
  })

const optionalSequenceText = (ctx: PrintContext, node: Node | null | undefined): string =>
  sequenceNodeText(ctx, node)

const forInStatementText = (ctx: PrintContext, node: ForInStatement): string =>
  `for (${Match.value(node.left).pipe(
    Match.when(isNode('VariableDeclaration'), (n) => variableDeclarationText(ctx, n)),
    Match.orElse((n) => printNodePrec(ctx, n, PREC.Sequence)),
  )} in ${printNodePrec(ctx, node.right, PREC.Sequence)}) ${statementOrBlockText(ctx, node.body)}`

const forOfStatementText = (ctx: PrintContext, node: ForOfStatement): string =>
  `${Boolean.match(node.await, {
    onTrue: () => 'for await (',
    onFalse: () => 'for (',
  })}${declarationOrExpressionText(ctx, node.left)} of ${sequenceNodeText(ctx, node.right)}) ${statementOrBlockText(
    ctx,
    node.body,
  )}`

const returnStatementText = (ctx: PrintContext, node: ReturnStatement): string =>
  Option.match(Option.fromNullishOr(node.argument), {
    onSome: (argument) => `return ${printNodePrec(ctx, argument, PREC.Sequence)};`,
    onNone: () => 'return;',
  })

const withStatementText = (ctx: PrintContext, node: WithStatement): string =>
  `with (${printNodePrec(ctx, node.object, PREC.Sequence)}) ${statementOrBlockText(ctx, node.body)}`

const switchStatementText = (ctx: PrintContext, node: SwitchStatement): string => {
  const inner: PrintContext = { indentLevel: ctx.indentLevel + 1 }
  return `switch (${sequenceNodeText(ctx, node.discriminant)}) {\n${node.cases
    .map((switchCase) => `${indent(inner)}${switchCaseText(inner, switchCase)}`)
    .join('')}${indent(ctx)}}`
}

const switchCaseText = (ctx: PrintContext, node: SwitchCase): string =>
  `${switchCaseHeaderText(ctx, node)}${indentedBodyText(ctx, node.consequent, statementText)}`

const switchCaseHeaderText = (ctx: PrintContext, node: SwitchCase): string =>
  Option.match(Option.fromNullishOr(node.test), {
    onSome: (test) => `case ${sequenceNodeText(ctx, test)}:\n`,
    onNone: () => 'default:\n',
  })

const labeledStatementText = (ctx: PrintContext, node: LabeledStatement): string =>
  `${node.label.name}: ${statementText(ctx, node.body)}`

const tryStatementText = (ctx: PrintContext, node: TryStatement): string =>
  `try ${blockStatementText(ctx, node.block)}${catchClauseText(ctx, node.handler)}${finallyClauseText(ctx, node.finalizer)}`

const catchClauseText = (ctx: PrintContext, handler: CatchClause | null | undefined): string =>
  Option.match(Option.fromNullishOr(handler), {
    onSome: (value) => ` catch${catchParamText(ctx, value.param)} ${blockStatementText(ctx, value.body)}`,
    onNone: () => '',
  })

const catchParamText = (ctx: PrintContext, param: BindingPattern | null | undefined): string =>
  Option.match(Option.fromNullishOr(param), {
    onSome: (value) => ` (${catchParamBodyText(ctx, value)})`,
    onNone: () => '',
  })

const catchParamBodyText = (ctx: PrintContext, param: BindingPattern): string =>
  Match.value(param).pipe(
    Match.when(isNode('Identifier'), (n) => identifierWithOptionalText(ctx, n)),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const finallyClauseText = (ctx: PrintContext, finalizer: BlockStatement | null | undefined): string =>
  Option.match(Option.fromNullishOr(finalizer), {
    onSome: (value) => ` finally ${blockStatementText(ctx, value)}`,
    onNone: () => '',
  })

const variableDeclarationText = (ctx: PrintContext, node: VariableDeclaration): string =>
  `${flagText(node.declare, 'declare ')}${node.kind} ${node.declarations
    .map((declaration) => variableDeclaratorText(ctx, declaration))
    .join(', ')}`

const variableDeclaratorText = (ctx: PrintContext, node: VariableDeclarator): string =>
  `${bindingTargetText(ctx, node.id)}${flagText(node.definite, '!')}${typeAnnotationText(
    ctx,
    bindingTypeAnnotation(node.id),
  )}${initializerText(ctx, node.init)}`

const bindingTargetText = (ctx: PrintContext, id: BindingPattern): string =>
  Match.value(id).pipe(
    Match.when(isNode('Identifier'), (n) => `${bindingNameText(n)}${flagText(n.optional, '?')}`),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const identifierWithOptionalText = (ctx: PrintContext, node: BindingIdentifier): string =>
  `${bindingNameText(node)}${flagText(node.optional, '?')}${typeAnnotationText(ctx, node.typeAnnotation)}`

const paramText = (ctx: PrintContext, param: ParamPattern): string =>
  Match.value(param).pipe(
    Match.when(isNode('RestElement'), (n) => restParamText(ctx, n)),
    Match.when(isNode('TSParameterProperty'), (n) => parameterPropertyText(ctx, n)),
    Match.when(isNode('Identifier'), (n) => formalParameterText(ctx, n)),
    Match.when(isNode('ObjectPattern'), (n) => formalParameterText(ctx, n)),
    Match.when(isNode('ArrayPattern'), (n) => formalParameterText(ctx, n)),
    Match.when(isNode('AssignmentPattern'), (n) => formalParameterText(ctx, n)),
    Match.orElse(() => ''),
  )

const restParamText = (
  ctx: PrintContext,
  param: Extract<ParamPattern, { readonly type: 'RestElement' }>,
): string =>
  `...${assignmentNodeText(ctx, param.argument)}${typeAnnotationText(ctx, param.typeAnnotation)}`

const parameterPropertyText = (
  ctx: PrintContext,
  param: Extract<ParamPattern, { readonly type: 'TSParameterProperty' }>,
): string =>
  `${decoratorsText(ctx, param.decorators)}${parameterPropertyModifiers(param)}${parameterPropertyTargetText(
    ctx,
    param.parameter,
  )}`

const parameterPropertyTargetText = (ctx: PrintContext, parameter: BindingPattern): string =>
  Match.value(parameter).pipe(
    Match.when(isNode('Identifier'), (n) => identifierWithOptionalText(ctx, n)),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const formalParameterText = (ctx: PrintContext, param: BindingPattern): string =>
  `${decoratorsText(ctx, param.decorators)}${formalParameterBodyText(ctx, param)}`

const formalParameterBodyText = (ctx: PrintContext, param: BindingPattern): string =>
  Match.value(param).pipe(
    Match.when(isNode('Identifier'), (n) => identifierWithOptionalText(ctx, n)),
    Match.orElse(
      (n) => `${assignmentNodeText(ctx, n)}${typeAnnotationText(ctx, bindingTypeAnnotation(n))}`,
    ),
  )

const classBodyText = (ctx: PrintContext, node: ClassBody): string =>
  Boolean.match(node.body.length === 0, {
    onTrue: () => '{}',
    onFalse: () =>
      `{\n${indentedBodyText(
        ctx,
        node.body,
        (inner, element) => printNodePrec(inner, element, PREC.Sequence),
      )}${indent(ctx)}}`,
  })
