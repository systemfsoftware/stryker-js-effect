const indentedBodyText = <T>(
  ctx: PrintContext,
  items: readonly T[],
  print: (ctx: PrintContext, item: T) => string,
): string => {
  const inner: PrintContext = { indentLevel: ctx.indentLevel + 1 }
  return items.map((item) => `${indent(inner)}${print(inner, item)}\n`).join('')
}

const methodDefinitionText = (ctx: PrintContext, node: MethodDefinition): string =>
  `${decoratorsText(ctx, node.decorators)}${methodDefinitionPrefix(node, node.value)}${propertyKeyText(
    ctx,
    node.key,
    node.computed === true,
    PREC.Sequence,
  )}${flagText(node.optional, '?')}${functionTailText(ctx, node.value)}`

const propertyDefinitionText = (ctx: PrintContext, node: PropertyDefinition): string =>
  `${decoratorsText(ctx, node.decorators)}${propertyDefinitionModifiers(node)}${propertyKeyText(
    ctx,
    node.key,
    node.computed === true,
    PREC.Sequence,
  )}${flagText(node.optional, '?')}${flagText(node.definite, '!')}${typeAnnotationText(
    ctx,
    node.typeAnnotation,
  )}${initializerText(ctx, node.value)};`

const accessorPropertyText = (ctx: PrintContext, node: AccessorProperty): string =>
  `${decoratorsText(ctx, node.decorators)}${flagText(node.accessibility, `${node.accessibility} `)}${flagText(
    node.static,
    'static ',
  )}${flagText(node.override, 'override ')}accessor ${propertyKeyText(
    ctx,
    node.key,
    node.computed === true,
    PREC.Sequence,
  )}${flagText(node.definite, '!')}${typeAnnotationText(ctx, node.typeAnnotation)}${initializerText(
    ctx,
    node.value,
  )};`

const initializerText = (ctx: PrintContext, value: Node | null | undefined): string =>
  flagText(value, ` = ${assignmentNodeText(ctx, value)}`)

const staticBlockText = (ctx: PrintContext, node: StaticBlock): string => {
  const inner: PrintContext = { indentLevel: ctx.indentLevel + 1 }
  return `static {\n${node.body
    .map((stmt) => `${indent(inner)}${statementText(inner, stmt)}\n`)
    .join('')}${indent(ctx)}}`
}

const importDeclarationText = (ctx: PrintContext, node: ImportDeclaration): string => {
  const source = importSourceText(node.source, node.attributes)
  return `import ${importKindText(node)}${importClauseText(node, source)};`
}

const importClauseText = (node: ImportDeclaration, source: string): string =>
  Boolean.match(node.specifiers.length === 0, {
    onTrue: () => source,
    onFalse: () => `${importBindingsText(node.specifiers)} from ${source}`,
  })

const importSourceText = (source: StringLiteral, attrs: readonly ImportAttribute[]): string =>
  `${source.raw ?? JSON.stringify(source.value)}${importAttributesText(attrs)}`

const exportNamedDeclarationText = (ctx: PrintContext, node: ExportNamedDeclaration): string =>
  Option.match(Option.fromNullishOr(node.declaration), {
    onSome: (declaration) => `export ${statementText(ctx, declaration)}`,
    onNone: () =>
      `export ${flagText(node.exportKind === 'type', 'type ')}{ ${node.specifiers
        .map((specifier) => exportSpecifierText(specifier))
        .join(', ')} }${exportSourceClauseText(node)};`,
  })

const exportSourceClauseText = (node: ExportNamedDeclaration): string =>
  Option.match(Option.fromNullishOr(node.source), {
    onSome: (source) => ` from ${JSON.stringify(source.value)}${importAttributesText(node.attributes)}`,
    onNone: () => '',
  })

const exportDefaultDeclarationText = (ctx: PrintContext, node: ExportDefaultDeclaration): string =>
  `export default ${Match.value(node.declaration).pipe(
    Match.when(isBareDefaultExport, (declaration) => statementText(ctx, declaration)),
    Match.orElse((declaration) => `${printNodePrec(ctx, declaration, PREC.Assignment)};`),
  )}`

const exportAllDeclarationText = (ctx: PrintContext, node: ExportAllDeclaration): string =>
  `export ${flagText(node.exportKind === 'type', 'type ')}*${exportedNameClauseText(node.exported)} from ${JSON.stringify(node.source.value)}${importAttributesText(node.attributes)};`

const tsTypeAliasDeclarationText = (ctx: PrintContext, node: TSTypeAliasDeclaration): string =>
  `${flagText(node.declare, 'declare ')}type ${node.id.name}${typeParametersText(ctx, node.typeParameters)} = ${printTSTypeToString(ctx, node.typeAnnotation)};`

const tsInterfaceDeclarationText = (ctx: PrintContext, node: TSInterfaceDeclaration): string =>
  `${flagText(node.declare, 'declare ')}interface ${node.id.name}${typeParametersText(
    ctx,
    node.typeParameters,
  )}${interfaceExtendsText(ctx, node.extends)} ${tsInterfaceBodyText(ctx, node.body)}`

const interfaceExtendsText = (ctx: PrintContext, extensions: TSInterfaceDeclaration['extends']): string => {
  const rendered = extensions.map((heritage) => heritageText(ctx, heritage)).join(', ')
  return flagText(rendered, ` extends ${rendered}`)
}

const tsInterfaceBodyText = (ctx: PrintContext, node: TSInterfaceBody): string =>
  Boolean.match(node.body.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{\n${indentedBodyText(ctx, node.body, printTSSignatureText)}${indent(ctx)}}`,
  })

const printTSSignatureText = (ctx: PrintContext, sig: TSInterfaceBody['body'][number]): string =>
  Match.value(sig).pipe(
    Match.when(isNode('TSPropertySignature'), (n) => printTSPropertySignatureText(ctx, n)),
    Match.when(isNode('TSIndexSignature'), (n) => printTSIndexSignatureText(ctx, n)),
    Match.when(isNode('TSCallSignatureDeclaration'), (n) => printTSCallSignatureText(ctx, n)),
    Match.when(isNode('TSConstructSignatureDeclaration'), (n) => printTSConstructSignatureText(ctx, n)),
    Match.when(isNode('TSMethodSignature'), (n) => printTSMethodSignatureText(ctx, n)),
    Match.orElse(() => ''),
  )

const printTSPropertySignatureText = (ctx: PrintContext, node: TSPropertySignature): string =>
  `${flagText(node.readonly, 'readonly ')}${propertyKeyText(ctx, node.key, node.computed === true, PREC.Sequence)}${flagText(node.optional, '?')}${typeAnnotationText(ctx, node.typeAnnotation)};`

const printTSIndexSignatureText = (ctx: PrintContext, node: TSIndexSignature): string => {
  const parameters = node.parameters.map((parameter) => indexParameterText(ctx, parameter)).join(', ')
  return `${flagText(node.readonly, 'readonly ')}${flagText(node.static, 'static ')}[${parameters}]${typeAnnotationText(ctx, node.typeAnnotation)};`
}

const indexParameterText = (ctx: PrintContext, parameter: TSIndexSignature['parameters'][number]): string =>
  `${parameter.name}: ${printTSTypeToString(ctx, parameter.typeAnnotation.typeAnnotation)}`

const printTSCallSignatureText = (ctx: PrintContext, node: TSCallSignatureDeclaration): string =>
  `${typeParametersText(ctx, node.typeParameters)}(${paramsText(ctx, node.params)})${typeAnnotationText(ctx, node.returnType)};`

const printTSConstructSignatureText = (ctx: PrintContext, node: TSConstructSignatureDeclaration): string =>
  `new ${typeParametersText(ctx, node.typeParameters)}(${paramsText(ctx, node.params)})${typeAnnotationText(ctx, node.returnType)};`

const printTSMethodSignatureText = (ctx: PrintContext, node: TSMethodSignature): string =>
  `${methodKindText(node.kind)}${propertyKeyText(ctx, node.key, node.computed === true, PREC.Sequence)}${flagText(node.optional, '?')}${typeParametersText(ctx, node.typeParameters)}(${paramsText(ctx, node.params)})${typeAnnotationText(ctx, node.returnType)};`

const tsEnumDeclarationText = (ctx: PrintContext, node: TSEnumDeclaration): string =>
  `${flagText(node.declare, 'declare ')}${flagText(node.const, 'const ')}enum ${node.id.name} {\n${indentedBodyText(
    ctx,
    node.body.members,
    printEnumMemberText,
  )}${indent(ctx)}}`

const printEnumMemberText = (ctx: PrintContext, member: TSEnumDeclaration['body']['members'][number]): string =>
  `${identifierOrLiteralNameText(ctx, member.id)}${initializerText(ctx, member.initializer)},`

const identifierOrLiteralNameText = (ctx: PrintContext, id: Node): string =>
  Match.value(id).pipe(
    Match.when(isNode('Identifier'), (n) => identifierNameText(n)),
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const tsModuleDeclarationText = (ctx: PrintContext, node: Extract<Node, { type: 'TSModuleDeclaration' }>): string =>
  `${flagText(node.declare, 'declare ')}${moduleHeaderText(ctx, node)}${moduleBodyText(ctx, node)}`

const moduleHeaderText = (ctx: PrintContext, node: Extract<Node, { type: 'TSModuleDeclaration' }>): string =>
  Boolean.match(node.global === true, {
    onTrue: () => 'global ',
    onFalse: () => `${node.kind} ${identifierOrLiteralNameText(ctx, node.id)}`,
  })

const moduleBodyText = (ctx: PrintContext, node: Extract<Node, { type: 'TSModuleDeclaration' }>): string =>
  Option.match(Option.fromNullishOr(node.body), {
    onSome: (body) => ` ${tsModuleBlockText(ctx, body)}`,
    onNone: () => ';',
  })

const tsModuleBlockText = (ctx: PrintContext, node: Extract<Node, { type: 'TSModuleBlock' }>): string =>
  `{\n${indentedBodyText(ctx, node.body, statementText)}${indent(ctx)}}`

const tsImportEqualsDeclarationText = (ctx: PrintContext, node: TSImportEqualsDeclaration): string =>
  `import ${flagText(node.importKind === 'type', 'type ')}${node.id.name} = ${moduleReferenceText(ctx, node.moduleReference)};`

const moduleReferenceText = (
  ctx: PrintContext,
  reference: TSImportEqualsDeclaration['moduleReference'],
): string =>
  Match.value(reference).pipe(
    Match.when(isNode('TSExternalModuleReference'), (n) => `require(${externalModuleArgumentText(n.expression.value)})`,
    ),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const printTSTypeToString = (ctx: PrintContext, node: TSType): string =>
  Match.value(node).pipe(
    Match.when(isNode('TSAnyKeyword'), () => 'any'),
    Match.when(isNode('TSStringKeyword'), () => 'string'),
    Match.when(isNode('TSBooleanKeyword'), () => 'boolean'),
    Match.when(isNode('TSNumberKeyword'), () => 'number'),
    Match.when(isNode('TSBigIntKeyword'), () => 'bigint'),
    Match.when(isNode('TSSymbolKeyword'), () => 'symbol'),
    Match.when(isNode('TSVoidKeyword'), () => 'void'),
    Match.when(isNode('TSUndefinedKeyword'), () => 'undefined'),
    Match.when(isNode('TSNullKeyword'), () => 'null'),
    Match.when(isNode('TSNeverKeyword'), () => 'never'),
    Match.when(isNode('TSUnknownKeyword'), () => 'unknown'),
    Match.when(isNode('TSObjectKeyword'), () => 'object'),
    Match.when(isNode('TSIntrinsicKeyword'), () => 'intrinsic'),
    Match.when(isNode('TSThisType'), () => 'this'),
    Match.when(isNode('TSTypeReference'), (n) => `${printTSTypeName(ctx, n.typeName)}${typeArgumentsText(ctx, n.typeArguments)}`,
    ),
    Match.when(isNode('TSUnionType'), (n) => tsTypeListText(ctx, n.types, ' | ')),
    Match.when(isNode('TSIntersectionType'), (n) => tsTypeListText(ctx, n.types, ' & ')),
    Match.when(isNode('TSArrayType'), (n) => `${arrayElementTypeText(ctx, n.elementType)}[]`),
    Match.when(isNode('TSTypeLiteral'), (n) => printTSTypeLiteral(ctx, n.members)),
    Match.when(isNode('TSTupleType'), (n) => printTupleType(ctx, n.elementTypes)),
    Match.when(isNode('TSConditionalType'), (n) =>
        `${printTSTypeToString(ctx, n.checkType)} extends ${printTSTypeToString(ctx, n.extendsType)} ? ${printTSTypeToString(ctx, n.trueType)} : ${printTSTypeToString(ctx, n.falseType)}`,
    ),
    Match.when(isNode('TSInferType'), (n) => `infer ${n.typeParameter.name.name}${printTypeClause(ctx, ' extends ', n.typeParameter.constraint)}`,
    ),
    Match.when(isNode('TSTypeQuery'), (n) => `typeof ${printTypeQueryName(ctx, n)}${typeArgumentsText(ctx, n.typeArguments)}`,
    ),
    Match.when(isNode('TSImportType'), (n) => printTSImportType(ctx, n)),
    Match.when(isNode('TSTypeOperator'), (n) => `${n.operator} ${printTSTypeToString(ctx, n.typeAnnotation)}`,
    ),
    Match.when(isNode('TSMappedType'), (n) => printMappedType(ctx, n)),
    Match.when(isNode('TSTemplateLiteralType'), (n) => printTSTemplateLiteral(ctx, n)),
    Match.when(isNode('TSFunctionType'), (n) =>
        `${typeParametersText(ctx, n.typeParameters)}(${paramsText(ctx, n.params)}) => ${printTSTypeToString(ctx, n.returnType.typeAnnotation)}`,
    ),
    Match.when(isNode('TSConstructorType'), (n) =>
        `${flagText(n.abstract, 'abstract ')}new ${typeParametersText(ctx, n.typeParameters)}(${paramsText(ctx, n.params)}) => ${printTSTypeToString(ctx, n.returnType.typeAnnotation)}`,
    ),
    Match.when(isNode('TSTypePredicate'), (n) => printTSTypePredicate(ctx, n)),
    Match.when(isNode('TSIndexedAccessType'), (n) => `${printTSTypeToString(ctx, n.objectType)}[${printTSTypeToString(ctx, n.indexType)}]`,
    ),
    Match.when(isNode('TSNamedTupleMember'), (n) => printNamedTupleMember(ctx, n)),
    Match.when(isNode('TSLiteralType'), (n) => printTSLiteralType(ctx, n.literal)),
    Match.when(isNode('TSParenthesizedType'), (n) => `(${printTSTypeToString(ctx, n.typeAnnotation)})`,
    ),
    Match.when(isNode('TSJSDocNullableType'), (n) => printJSDocPostfixModifier(ctx, n, '?')),
    Match.when(isNode('TSJSDocNonNullableType'), (n) => printJSDocPostfixModifier(ctx, n, '!')),
    Match.when(isNode('TSJSDocUnknownType'), () => '?'),
    Match.orElse(() => ''),
  )

const tsTypeListText = (ctx: PrintContext, types: readonly TSType[], separator: string): string =>
  types.map((type) => printTSTypeToString(ctx, type)).join(separator)

const arrayElementTypeText = (ctx: PrintContext, type: TSType): string =>
  parenthesizedIf(
    ARRAY_ELEMENT_WRAPPED_KINDS[type.type] === true,
    printTSTypeToString(ctx, type),
  )

const printTSTypeLiteral = (ctx: PrintContext, members: readonly TSInterfaceBody['body'][number][]): string =>
  Boolean.match(members.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{ ${members.map((member) => signatureText(ctx, member)).join('; ')} }`,
  })

const signatureText = (ctx: PrintContext, member: TSInterfaceBody['body'][number]): string => {
  const printed = printTSSignatureText(ctx, member)
  return Boolean.match(printed.endsWith(';'), {
    onTrue: () => printed.slice(0, -1),
    onFalse: () => printed,
  })
}

const printTupleType = (ctx: PrintContext, elements: TSTupleType['elementTypes']): string =>
  `[${elements.map((element) => printTupleElement(ctx, element)).join(', ')}]`

const printTupleElement = (ctx: PrintContext, element: TSTupleType['elementTypes'][number]): string =>
  Match.value(element).pipe(
    Match.when(isNode('TSRestType'), (n) => `...${printTSTypeToString(ctx, n.typeAnnotation)}`),
    Match.when(isNode('TSOptionalType'), (n) => `${printTSTypeToString(ctx, n.typeAnnotation)}?`),
    Match.when(isNode('TSNamedTupleMember'), (n) => printNamedTupleMember(ctx, n)),
    Match.when(isTSType, (n) => printTSTypeToString(ctx, n)),
    Match.orElse(() => ''),
  )

const printNamedTupleMember = (ctx: PrintContext, member: TSNamedTupleMember): string =>
  `${member.label.name}${flagText(member.optional, '?')}: ${printTupleElement(ctx, member.elementType)}`

const printTypeClause = (ctx: PrintContext, keyword: string, type: TSType | null | undefined): string =>
  Option.match(Option.fromNullishOr(type), {
    onSome: (value) => `${keyword}${printTSTypeToString(ctx, value)}`,
    onNone: () => '',
  })

const printTypeQueryName = (ctx: PrintContext, node: TSTypeQuery): string =>
  Match.value(node.exprName).pipe(
    Match.when(isNode('TSImportType'), (n) => printTSTypeToString(ctx, n)),
    Match.orElse((n) => printTSTypeName(ctx, n)),
  )

const printTSTypeName = (ctx: PrintContext, name: TSTypeReference['typeName']): string =>
  Match.value(name).pipe(
    Match.when(isNode('TSQualifiedName'), (n) => `${printTSTypeName(ctx, n.left)}.${n.right.name}`),
    Match.when(isNode('Identifier'), (n) => n.name),
    Match.when(isNode('ThisExpression'), () => 'this'),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const printTSImportTypeQualifier = (ctx: PrintContext, qualifier: TSImportType['qualifier']): string =>
  Option.match(Option.fromNullishOr(qualifier), {
    onSome: (value) => printTSImportTypeQualifierNode(ctx, value),
    onNone: () => '',
  })

const printTSImportTypeQualifierNode = (
  ctx: PrintContext,
  qualifier: NonNullable<TSImportType['qualifier']>,
): string =>
  Match.value(qualifier).pipe(
    Match.when(isNode('Identifier'), (n) => n.name),
    Match.orElse(
      (n) => `${printTSImportTypeQualifier(ctx, n.left)}.${n.right.name}`,
    ),
  )

const printTSImportType = (ctx: PrintContext, node: TSImportType): string =>
  `import(${JSON.stringify(node.source.value)}${flagText(
    node.options,
    `, ${assignmentNodeText(ctx, node.options)}`,
  )})${Option.match(Option.fromNullishOr(node.qualifier), {
    onSome: (qualifier) => `.${printTSImportTypeQualifierNode(ctx, qualifier)}`,
    onNone: () => '',
  })}${typeArgumentsText(ctx, node.typeArguments)}`

const printMappedType = (ctx: PrintContext, node: TSMappedType): string =>
  `{ ${printMappedTypeModifier(node.readonly, 'readonly ')}[${node.key.name} in ${printTSTypeToString(
    ctx,
    node.constraint,
  )}${printTypeClause(ctx, ' as ', node.nameType)}]${printMappedTypeModifier(node.optional, '?')}${printTypeClause(ctx, ': ', node.typeAnnotation)} }`

const printMappedTypeModifier = <A = unknown>(modifier: A, rendered: string): string =>
  Match.value(modifier).pipe(
    Match.when(true, () => rendered),
    Match.when('+', () => `+${rendered}`),
    Match.when('-', () => `-${rendered}`),
    Match.orElse(() => ''),
  )

const printTSTemplateLiteral = (ctx: PrintContext, node: TSTemplateLiteralType): string => {
  const tail = Arr.last(node.quasis)
  const segments = Arr.zipWith(
    Arr.dropRight(node.quasis, 1),
    node.types,
    (quasi, type) => `${quasi.value.raw}\${${printTSTypeToString(ctx, type)}}`,
  )
  return `\`${Arr.join(segments, '')}${Option.match(tail, {
    onSome: (quasi) => quasi.value.raw,
    onNone: () => '',
  })}\``
}

const printTSTypePredicate = (ctx: PrintContext, node: TSTypePredicate): string =>
  `${flagText(node.asserts, 'asserts ')}${typePredicateParameterText(node.parameterName)}${printPredicateAnnotation(ctx, node)}`

const printPredicateAnnotation = (ctx: PrintContext, node: TSTypePredicate): string =>
  Option.match(Option.fromNullishOr(node.typeAnnotation), {
    onSome: (annotation) => printTypeClause(ctx, ' is ', annotation.typeAnnotation),
    onNone: () => '',
  })

const printTSLiteralType = (ctx: PrintContext, literal: TSLiteralType['literal']): string =>
  Match.value(literal).pipe(
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.when(isNode('TemplateLiteral'), (n) => templateLiteralText(ctx, n)),
    Match.when(isNode('UnaryExpression'), (n) =>
        `${n.operator}${Match.value(n.argument).pipe(
          Match.when(isNode('Literal'), (argument) => literalText(argument)),
          Match.orElse(() => ''),
        )}`,
    ),
    Match.orElse(() => ''),
  )

const printJSDocPostfixModifier = (
  ctx: PrintContext,
  node: JSDocNullableType | JSDocNonNullableType,
  marker: string,
): string =>
  Boolean.match(node.postfix, {
    onTrue: () => `${printTSTypeToString(ctx, node.typeAnnotation)}${marker}`,
    onFalse: () => `${marker}${printTSTypeToString(ctx, node.typeAnnotation)}`,
  })

const printTSTypeAnnotation = (ctx: PrintContext, node: TSTypeAnnotation): string =>
  `: ${printTSTypeToString(ctx, node.typeAnnotation)}`

const printTSTypeParameterDeclaration = (ctx: PrintContext, node: TSTypeParameterDeclaration): string =>
  `<${node.params.map((param) => printTSTypeParameter(ctx, param)).join(', ')}>`

const printTSTypeParameterInstantiation = (ctx: PrintContext, node: TSTypeParameterInstantiation): string =>
  `<${node.params.map((param) => printTSTypeToString(ctx, param)).join(', ')}>`

const printTSTypeParameter = (ctx: PrintContext, node: TSTypeParameterDeclaration['params'][number]): string =>
  `${typeParameterModifiersText(node)}${node.name.name}${printTypeClause(ctx, ' extends ', node.constraint)}${printTypeClause(ctx, ' = ', node.default)}`

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

const isTSType = (node: Node): node is TSType => TS_TYPE_NODE_KINDS[node.type] === true

const FUNCTION_KINDS: Readonly<Record<string, true>> = {
  FunctionDeclaration: true,
  FunctionExpression: true,
  TSDeclareFunction: true,
  TSEmptyBodyFunctionExpression: true,
}

const isFunctionNode = (node: Node): node is FunctionNode => FUNCTION_KINDS[node.type] === true

const isAssignmentPattern = (node: Node): node is AssignmentPattern => node.type === 'AssignmentPattern'

const isIdentifierNode = (node: Node | null | undefined): node is Extract<Node, { type: 'Identifier' }> =>
  node?.type === 'Identifier'

const identifierName = (node: Node | null | undefined): string | undefined =>
  Option.getOrUndefined(Option.map(Option.filter(Option.fromNullishOr(node), isIdentifierNode), (n) => n.name))

const identifierNameText = (node: Node | null | undefined): string => identifierName(node) ?? ''

const privateIdentifierText = (node: Node | null | undefined): string =>
  Match.value(node).pipe(
    Match.when(isNode('PrivateIdentifier'), (n) => `#${n.name}`),
    Match.orElse(() => ''),
  )

const precOf = (node: Node): number =>
  Match.value(node).pipe(
    Match.when(isNode('SequenceExpression'), () => PREC.Sequence),
    Match.when(isNode('AssignmentExpression'), () => PREC.Assignment),
    Match.when(isNode('ConditionalExpression'), () => PREC.Conditional),
    Match.when(isNode('LogicalExpression'), (n) => logicalPrec(n.operator),
    ),
    Match.when(isNode('BinaryExpression'), (n) => binaryPrec(n.operator),
    ),
    Match.when(isNode('UnaryExpression'), () => PREC.Unary),
    Match.when(isNode('AwaitExpression'), () => PREC.Unary),
    Match.when(isNode('YieldExpression'), () => PREC.Unary),
    Match.when(isNode('UpdateExpression'), () => PREC.Update),
    Match.when(isNode('CallExpression'), () => PREC.Call),
    Match.when(isNode('NewExpression'), () => PREC.Call),
    Match.when(isNode('TaggedTemplateExpression'), () => PREC.Call),
    Match.when(isNode('ImportExpression'), () => PREC.Call),
    Match.when(isNode('MemberExpression'), () => PREC.Member),
    Match.when(isNode('ChainExpression'), () => PREC.Member),
    Match.orElse(() => PREC.Primary),
  )

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

const jsxAttributeNameText = (name: JSXAttribute['name']): string =>
  Match.value(name).pipe(
    Match.when(isNode('JSXIdentifier'), (n) => n.name),
    Match.orElse((n) => `${n.namespace.name}:${n.name.name}`),
  )

interface PropertyLike {
  readonly type: 'Property'
  readonly kind?: string
  readonly method?: boolean
  readonly shorthand?: boolean
  readonly computed: boolean
  readonly key: Node
  readonly value: Node
}

const propertyFormOf = (fields: PropertyLike): PropertyForm =>
  Match.value(fields).pipe(
    Match.when(isAccessorKind, () => 'accessor'),
    Match.when(isMethodKind, () => 'method'),
    Match.when(isShorthandMatch, () => 'shorthand'),
    Match.when(isShorthandDefaultMatch, () => 'shorthandDefault'),
    Match.orElse(() => 'verbose'),
  )

const isAccessorKind = (fields: PropertyLike): boolean => fields.kind === 'get' || fields.kind === 'set'

const isMethodKind = (fields: PropertyLike): boolean => fields.method === true

const isShorthandMatch = (fields: PropertyLike): boolean =>
  fields.shorthand === true && namesMatch(identifierName(fields.key), identifierName(fields.value))

const isShorthandDefaultMatch = (fields: PropertyLike): boolean =>
  fields.shorthand === true && namesMatch(identifierName(fields.key), defaultTargetName(fields.value))

const defaultTargetName = (node: Node | null | undefined): string | undefined =>
  Option.getOrUndefined(
    Option.map(Option.filter(Option.some(node), isAssignmentPattern), (value) => identifierName(value.left)),
  )

const namesMatch = (key: string | undefined, value: string | undefined): boolean =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: () => false,
    onSome: (nonNull) => key === nonNull,
  })

const BINDING_TYPE_ANNOTATION_KINDS: Readonly<Record<string, true>> = {
  Identifier: true,
  ObjectPattern: true,
  ArrayPattern: true,
}

const bindingTypeAnnotation = (node: Node): TSTypeAnnotation | null | undefined =>
  Option.getOrUndefined(
    Option.filter(Option.some(node), isBindingTypeAnnotationCarrier).pipe(
      Option.map((carrier) => carrier.typeAnnotation),
    ),
  )

const isBindingTypeAnnotationCarrier = (
  node: Node,
): node is Extract<Node, { type: 'Identifier' | 'ObjectPattern' | 'ArrayPattern' }> =>
  BINDING_TYPE_ANNOTATION_KINDS[node.type] === true

const bindingNameText = (node: { readonly name?: string }): string => node.name ?? ''

interface ExportNameNode {
  readonly type: string
  readonly name?: string
  readonly value?: string
}

const EXPORT_NAME_TEXTS: Readonly<Record<string, (name: ExportNameNode) => string>> = {
  Identifier: (name) => name.name ?? '',
  Literal: (name) => name.value ?? '',
}

const exportNameToString = (name: ExportNameNode): string =>
  (EXPORT_NAME_TEXTS[name.type] ?? ((exported: ExportNameNode) => exported.value ?? ''))(name)

const importKindText = (node: ImportDeclaration): string => flagText(node.importKind === 'type', 'type ')

interface ImportBinding {
  readonly type: string
  readonly local: { readonly name: string }
  readonly imported?: { readonly type: string; readonly name?: string; readonly value?: string }
  readonly importKind?: string
}

const importBindingsText = (specifiers: readonly ImportBinding[]): string =>
  [
    defaultSpecifierText(specifiers),
    namespaceSpecifierText(specifiers),
    namedSpecifiersText(specifiers),
  ]
    .filter((text) => text.length > 0)
    .join(', ')

const defaultSpecifierText = (specifiers: readonly ImportBinding[]): string =>
  importLocalName(specifiers.find((specifier) => specifier.type === 'ImportDefaultSpecifier'))

const namespaceSpecifierText = (specifiers: readonly ImportBinding[]): string => {
  const name = importLocalName(specifiers.find((specifier) => specifier.type === 'ImportNamespaceSpecifier'))
  return flagText(name, `* as ${name}`)
}

const namedSpecifiersText = (specifiers: readonly ImportBinding[]): string => {
  const rendered = specifiers
    .filter((specifier) => specifier.type === 'ImportSpecifier')
    .map((specifier) => namedSpecifierText(specifier))
    .join(', ')
  return flagText(rendered, `{ ${rendered} }`)
}

const namedSpecifierText = (specifier: ImportBinding): string =>
  `${flagText(specifier.importKind === 'type', 'type ')}${exportAliasText(
    importedNameText(specifier.imported),
    specifier.local.name,
  )}`

const importLocalName = (specifier: ImportBinding | undefined): string =>
  Option.match(Option.fromUndefinedOr(specifier), {
    onSome: (value) => value.local.name,
    onNone: () => '',
  })

const importedNameText = (imported: ImportBinding['imported']): string =>
  Option.match(Option.fromUndefinedOr(imported), {
    onSome: (value) => importedNameOf(value),
    onNone: () => '',
  })

const importedNameOf = (imported: NonNullable<ImportBinding['imported']>): string =>
  Match.value(imported.type).pipe(
    Match.when('Identifier', () => imported.name ?? ''),
    Match.orElse(() => imported.value ?? ''),
  )

const exportAliasText = (localName: string, exportedName: string): string =>
  Boolean.match(localName === exportedName, {
    onTrue: () => localName,
    onFalse: () => `${localName} as ${exportedName}`,
  })

const exportSpecifierText = (specifier: {
  readonly local: ExportNameNode
  readonly exported: ExportNameNode
  readonly exportKind?: string
}): string =>
  `${flagText(specifier.exportKind === 'type', 'type ')}${exportAliasText(
    exportNameToString(specifier.local),
    exportNameToString(specifier.exported),
  )}`

const exportedNameClauseText = (exported: ExportNameNode | null | undefined): string =>
  Option.match(Option.fromNullishOr(exported), {
    onSome: (value) => ` as ${exportNameToString(value)}`,
    onNone: () => '',
  })

const importAttributesText = (attrs: readonly ImportAttribute[]): string => {
  const rendered = attrs.map((attribute) => importAttributeText(attribute)).join(', ')
  return flagText(rendered, ` with { ${rendered} }`)
}

const importAttributeText = (attribute: ImportAttribute): string =>
  `${importAttrKeyText(attribute.key)}: ${JSON.stringify(attribute.value.value)}`

const importAttrKeyText = (key: ImportAttribute['key']): string =>
  Match.value(key).pipe(
    Match.when(isNode('Identifier'), (n) => n.name),
    Match.orElse((n) => JSON.stringify(n.value)),
  )

const bareArrowParamName = (node: ArrowFunctionExpression): string => {
  const name = singleParamName(node)
  return flagText(name.length > 0 && node.returnType == null, name)
}

const singleParamName = (node: ArrowFunctionExpression): string =>
  Match.value(node.params.length).pipe(
    Match.when(1, () => bareParameterName(Arr.head(node.params))),
    Match.orElse(() => ''),
  )

const bareParameterName = (param: Option.Option<ParamPattern>): string =>
  Option.match(param, {
    onSome: (value) => bareParameterNameOf(value),
    onNone: () => '',
  })

const isUnannotatedIdentifier = (
  param: ParamPattern,
): param is Extract<ParamPattern, { readonly type: 'Identifier' }> =>
  param.type === 'Identifier' && param.typeAnnotation == null

const bareParameterNameOf = (param: ParamPattern): string =>
  Option.getOrElse(
    Option.map(Option.filter(Option.some(param), isUnannotatedIdentifier), (n) => n.name),
    () => '',
  )

const functionHeaderText = (node: FunctionNode): string =>
  `${flagText(node.declare, 'declare ')}${flagText(node.async, 'async ')}function${flagText(
    node.generator,
    '*',
  )}${namedDeclarationText(node)}`

const namedDeclarationText = (node: { readonly id?: { readonly name: string } | null }): string =>
  Option.match(Option.fromNullishOr(node.id), {
    onSome: (id) => ` ${id.name}`,
    onNone: () => '',
  })

const parameterPropertyModifiers = (
  param: Extract<ParamPattern, { readonly type: 'TSParameterProperty' }>,
): string =>
  `${flagText(param.accessibility, `${param.accessibility} `)}${flagText(param.readonly, 'readonly ')}${flagText(
    param.override,
    'override ',
  )}${flagText(param.static, 'static ')}`

const commentText = (comment: AttachedComment): string =>
  Match.value(comment.type).pipe(
    Match.when('Block', () => `/*${comment.value}*/`),
    Match.orElse(() => `//${comment.value}`),
  )

const methodDefinitionPrefix = (node: MethodDefinition, fn: FunctionNode): string =>
  `${flagText(node.accessibility, `${node.accessibility} `)}${flagText(node.static, 'static ')}${flagText(
    node.override,
    'override ',
  )}${flagText(fn.async, 'async ')}${flagText(fn.generator, '*')}${methodKindText(node.kind)}`

const methodKindText = (kind: string): string =>
  Match.value(kind).pipe(
    Match.when('get', () => 'get '),
    Match.when('set', () => 'set '),
    Match.orElse(() => ''),
  )

const propertyDefinitionModifiers = (node: PropertyDefinition): string =>
  `${flagText(node.declare, 'declare ')}${flagText(node.accessibility, `${node.accessibility} `)}${flagText(
    node.static,
    'static ',
  )}${flagText(node.readonly, 'readonly ')}${flagText(node.override, 'override ')}`

type LiteralSource<A = unknown> = {
  readonly value: A
  readonly raw: string | null
  readonly bigint?: string
  readonly regex?: { readonly pattern: string; readonly flags: string }
}

const BARE_DEFAULT_EXPORT_KINDS: Readonly<Record<string, true>> = {
  FunctionDeclaration: true,
  ClassDeclaration: true,
  TSInterfaceDeclaration: true,
}

const isBareDefaultExport = (
  node: ExportDefaultDeclaration['declaration'],
): node is FunctionNode | Class | TSInterfaceDeclaration =>
  BARE_DEFAULT_EXPORT_KINDS[node.type] === true

const typeParameterModifiersText = (node: TSTypeParameterDeclaration['params'][number]): string =>
  `${flagText(node.in, 'in ')}${flagText(node.out, 'out ')}${flagText(node.const, 'const ')}`

const typePredicateParameterText = (parameterName: TSTypePredicate['parameterName']): string =>
  Match.value(parameterName).pipe(
    Match.when(isNode('TSThisType'), () => 'this'),
    Match.orElse((n) => n.name),
  )

const externalModuleArgumentText = (value: string): string =>
  Boolean.match(Predicate.isTruthy(value), {
    onTrue: () => JSON.stringify(value),
    onFalse: () => '""',
  })

interface AttachedComment {
  readonly type: string
  readonly value: string
}

interface CommentHost {
  readonly type: string
  readonly leadingComments?: readonly AttachedComment[]
  readonly trailingComments?: readonly AttachedComment[]
}
