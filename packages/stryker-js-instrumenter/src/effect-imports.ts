import type {
  ArrowFunctionExpression,
  BindingPattern,
  BindingProperty,
  BindingRestElement,
  BlockStatement,
  CallExpression,
  CatchClause,
  Class,
  ExportNamedDeclaration,
  Expression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Function,
  IdentifierName,
  IdentifierReference,
  ImportDeclaration,
  Literal,
  MemberExpression,
  Node,
  Program,
  StaticBlock,
  StringLiteral,
  SwitchStatement,
  ThisExpression,
  TSEnumDeclaration,
  TSImportEqualsDeclaration,
  TSModuleBlock,
  TSModuleDeclaration,
  VariableDeclaration,
} from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import { identifier, make, memberExpression, nodeType, traverse, type TraversePath } from './Ast.handle.js'
import type { MutatorContext } from './Mutator.service.js'

export type EffectModuleName = 'Effect' | 'Ref' | 'Semaphore' | 'SynchronizedRef'

const EFFECT_SOURCE = 'effect'
const FUNCTION_SOURCE = 'effect/Function'

type ImportSpecifierUnion = ImportDeclaration['specifiers'][number]

type NamedImportSpecifier = Extract<ImportSpecifierUnion, { readonly type: 'ImportSpecifier' }>

type NamespaceImportSpecifier = Extract<ImportSpecifierUnion, { readonly type: 'ImportNamespaceSpecifier' }>

type NamespaceBinding<M extends string = EffectModuleName> =
  | { readonly kind: 'root' }
  | { readonly kind: 'functionModule' }
  | { readonly kind: 'module'; readonly module: M }

export interface BareFunctionBinding<M extends string = EffectModuleName> {
  readonly module: M
  readonly exportName: string
}

export interface ImportTable<M extends string = EffectModuleName> {
  readonly modules: readonly M[]
  readonly moduleBindings: ReadonlyMap<string, M>
  readonly namespaces: ReadonlyMap<string, NamespaceBinding<M>>
  readonly bareFunctions: ReadonlyMap<string, BareFunctionBinding<M>>
  readonly pipeBindings: ReadonlySet<string>
  readonly valueLocals: ReadonlySet<string>
}

const emptyImportTable = <M extends string>(modules: readonly M[]): ImportTable<M> => ({
  modules,
  moduleBindings: new Map<string, M>(),
  namespaces: new Map<string, NamespaceBinding<M>>(),
  bareFunctions: new Map<string, BareFunctionBinding<M>>(),
  pipeBindings: new Set<string>(),
  valueLocals: new Set<string>(),
})

type ImportContribution<M extends string = EffectModuleName> =
  | { readonly kind: 'module'; readonly local: string; readonly module: M }
  | { readonly kind: 'namespace'; readonly local: string; readonly binding: NamespaceBinding<M> }
  | {
    readonly kind: 'bareFunction'
    readonly local: string
    readonly module: M
    readonly exportName: string
  }
  | { readonly kind: 'pipe'; readonly local: string }

const buildImportTableDataFirst = <M extends string>(program: Program, modules: readonly M[]): ImportTable<M> =>
  Arr.reduce(
    Arr.flatMap(
      Arr.filter(program.body, isImportDeclaration),
      (declaration: ImportDeclaration) => importContributions(declaration, modules),
    ),
    { ...emptyImportTable<M>(modules), valueLocals: valueImportLocals(program) },
    applyContribution,
  )

export const buildImportTable: {
  <M extends string>(program: Program, modules: readonly M[]): ImportTable<M>
  <M extends string>(modules: readonly M[]): (program: Program) => ImportTable<M>
} = dual((args: IArguments): boolean => args.length >= 2, buildImportTableDataFirst)

const valueImportLocals = (program: Program): ReadonlySet<string> =>
  new Set(Arr.flatMap(Arr.filter(program.body, isImportDeclaration), valueSpecifierLocals))

const valueSpecifierLocals = (declaration: ImportDeclaration): readonly string[] =>
  Option.toArray(onlyWhen(declaration.importKind !== 'type', declaration)).flatMap((imported) =>
    imported.specifiers.flatMap(valueSpecifierLocal)
  )

const valueSpecifierLocal = (specifier: ImportSpecifierUnion): readonly string[] =>
  Match.value(specifier).pipe(
    Match.when(isNamedImportSpecifier, (named) =>
      Option.toArray(onlyWhen(named.importKind !== 'type', named.local.name))),
    Match.orElse((other) => [other.local.name]),
  )

const withEntry = <K, V>(entries: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> =>
  new Map([...entries, [key, value]])

const withMember = <V>(members: ReadonlySet<V>, value: V): ReadonlySet<V> => new Set([...members, value])

const applyContribution = <M extends string>(
  table: ImportTable<M>,
  contribution: ImportContribution<M>,
): ImportTable<M> =>
  Match.value(contribution).pipe(
    Match.when(
      (candidate) => candidate.kind === 'module',
      (moduleBinding) => ({
        ...table,
        moduleBindings: withEntry(table.moduleBindings, moduleBinding.local, moduleBinding.module),
      }),
    ),
    Match.when(
      (candidate) => candidate.kind === 'namespace',
      (namespaceBinding) => ({
        ...table,
        namespaces: withEntry(table.namespaces, namespaceBinding.local, namespaceBinding.binding),
      }),
    ),
    Match.when(
      (candidate) => candidate.kind === 'bareFunction',
      (bareFunction) => ({
        ...table,
        bareFunctions: withEntry(table.bareFunctions, bareFunction.local, {
          module: bareFunction.module,
          exportName: bareFunction.exportName,
        }),
      }),
    ),
    Match.orElse((pipeBinding) => ({
      ...table,
      pipeBindings: withMember(table.pipeBindings, pipeBinding.local),
    })),
  )

const importContributions = <M extends string>(
  declaration: ImportDeclaration,
  modules: readonly M[],
): readonly ImportContribution<M>[] =>
  Option.toArray(onlyWhen(declaration.importKind !== 'type', declaration)).flatMap((imported) =>
    Arr.flatMap(
      imported.specifiers,
      (specifier) => Option.toArray(specifierContribution(imported.source.value, specifier, modules)),
    )
  )

const specifierContribution = <M extends string>(
  source: string,
  specifier: ImportSpecifierUnion,
  modules: readonly M[],
): Option.Option<ImportContribution<M>> =>
  Match.value(specifier).pipe(
    Match.when(isNamedImportSpecifier, (named) => namedSpecifierContribution(source, named, modules)),
    Match.when(isNamespaceImportSpecifier, (namespace) => namespaceSpecifierContribution(source, namespace, modules)),
    Match.orElse(() => Option.none()),
  )

const namedSpecifierContribution = <M extends string>(
  source: string,
  specifier: NamedImportSpecifier,
  modules: readonly M[],
): Option.Option<ImportContribution<M>> =>
  onlyWhen(specifier.importKind !== 'type', specifier).pipe(
    Option.flatMap((imported) =>
      namedContribution(source, moduleExportName(imported.imported), imported.local.name, modules)
    ),
  )

const namedContribution = <M extends string>(
  source: string,
  importedName: string,
  localName: string,
  modules: readonly M[],
): Option.Option<ImportContribution<M>> =>
  Match.value(source).pipe(
    Match.when((candidate) => candidate === EFFECT_SOURCE, () =>
      effectRootContribution(importedName, localName, modules)),
    Match.when((candidate) =>
      candidate === FUNCTION_SOURCE, () => pipeContribution<M>(importedName, localName)),
    Match.orElse(() =>
      Option.map(moduleNameFromSource(source, modules), (module) =>
        bareFunctionContribution(localName, module, importedName))
    ),
  )

const effectRootContribution = <M extends string>(
  importedName: string,
  localName: string,
  modules: readonly M[],
): Option.Option<ImportContribution<M>> =>
  Option.orElse(
    Option.map(moduleNameFromName(importedName, modules), (module) => moduleContribution(localName, module)),
    () => pipeContribution<M>(importedName, localName),
  )

const pipeContribution = <M extends string = EffectModuleName>(
  importedName: string,
  localName: string,
): Option.Option<ImportContribution<M>> => onlyWhen(importedName === 'pipe', pipeContributionOf<M>(localName))

const namespaceSpecifierContribution = <M extends string>(
  source: string,
  specifier: NamespaceImportSpecifier,
  modules: readonly M[],
): Option.Option<ImportContribution<M>> =>
  Option.map(namespaceBindingFor(source, modules), (binding) => ({
    kind: 'namespace',
    local: specifier.local.name,
    binding,
  }))

const moduleContribution = <M extends string>(local: string, module: M): ImportContribution<M> => ({
  kind: 'module',
  local,
  module,
})

const bareFunctionContribution = <M extends string>(
  local: string,
  module: M,
  exportName: string,
): ImportContribution<M> => ({ kind: 'bareFunction', local, module, exportName })

const pipeContributionOf = <M extends string = EffectModuleName>(local: string): ImportContribution<M> => ({
  kind: 'pipe',
  local,
})

const namespaceBindingFor = <M extends string>(
  source: string,
  modules: readonly M[],
): Option.Option<NamespaceBinding<M>> =>
  Match.value(source).pipe(
    Match.when((candidate) => candidate === EFFECT_SOURCE, () => Option.some<NamespaceBinding<M>>({ kind: 'root' })),
    Match.when((candidate) => candidate === FUNCTION_SOURCE, () =>
      Option.some<NamespaceBinding<M>>({ kind: 'functionModule' })),
    Match.orElse(() =>
      Option.map(moduleNameFromSource(source, modules), (module): NamespaceBinding<M> => ({ kind: 'module', module }))
    ),
  )

const moduleNameFromName = <M extends string>(name: string, modules: readonly M[]): Option.Option<M> =>
  Arr.findFirst(modules, (module) => module === name)

const moduleNameFromSource = <M extends string>(source: string, modules: readonly M[]): Option.Option<M> =>
  Arr.findFirst(modules, (module) => source === `${EFFECT_SOURCE}/${module}`)

export interface Callee<M extends string = EffectModuleName> {
  readonly module: M
  readonly exportName: string
  readonly owner: Option.Option<ModuleObject<M>>
}

export interface ModuleObject<M extends string = EffectModuleName> {
  readonly module: M
  readonly access: Expression
}

const resolveCalleeDataFirst = <M extends string>(
  callee: Expression,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<Callee<M>> =>
  Match.value(callee).pipe(
    Match.when(isIdentifier, (reference) => resolveBareCallee(reference, context, table)),
    Match.when(isMemberExpression, (member) => resolveMemberCallee(member, context, table)),
    Match.orElse(() => Option.none()),
  )

export const resolveCallee: {
  <M extends string>(callee: Expression, context: MutatorContext, table: ImportTable<M>): Option.Option<Callee<M>>
  <M extends string>(context: MutatorContext, table: ImportTable<M>): (callee: Expression) => Option.Option<Callee<M>>
} = dual((args: IArguments): boolean => args.length >= 3, resolveCalleeDataFirst)

const resolveBareCallee = <M extends string>(
  reference: IdentifierReference,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<Callee<M>> =>
  Option.flatMap(
    Option.fromNullishOr(table.bareFunctions.get(reference.name)),
    (binding) =>
      Option.map(unshadowedName(reference.name, context), () => ({
        module: binding.module,
        exportName: binding.exportName,
        owner: Option.none<ModuleObject<M>>(),
      })),
  )

const resolveMemberCallee = <M extends string>(
  member: MemberExpression,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<Callee<M>> =>
  Option.flatMap(
    staticMemberName(member),
    (exportName) =>
      Option.map(resolveModuleObject(member.object, context, table), (owner) => ({
        module: owner.module,
        exportName,
        owner: Option.some(owner),
      })),
  )

const resolveModuleObject = <M extends string>(
  expression: Expression,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<ModuleObject<M>> =>
  Match.value(expression).pipe(
    Match.when(isIdentifier, (reference) => identifierModuleObject(reference, context, table)),
    Match.when(isMemberExpression, (member) => namespacedModuleObject(member, context, table)),
    Match.orElse(() => Option.none()),
  )

const identifierModuleObject = <M extends string>(
  reference: IdentifierReference,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<ModuleObject<M>> =>
  Option.orElse(
    Option.flatMap(Option.fromNullishOr(table.moduleBindings.get(reference.name)), (module) =>
      Option.map(unshadowedName(reference.name, context), () => ({ module, access: reference }))),
    () =>
      Option.flatMap(namespaceOf(reference, context, table), (binding) =>
        Option.map(moduleOf(binding), (module) => ({ module, access: reference }))),
  )

const namespacedModuleObject = <M extends string>(
  member: MemberExpression,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<ModuleObject<M>> =>
  Option.flatMap(
    staticMemberName(member),
    (moduleName) =>
      Option.flatMap(namespaceOf(member.object, context, table), (binding) =>
        moduleObjectOfNamespace(binding, moduleName, member, table)),
  )

const moduleObjectOfNamespace = <M extends string>(
  binding: NamespaceBinding<M>,
  moduleName: string,
  member: MemberExpression,
  table: ImportTable<M>,
): Option.Option<ModuleObject<M>> =>
  binding.kind === 'root'
    ? rootModuleObject(moduleName, member, table)
    : namedModuleObject(binding, moduleName, member)

const rootModuleObject = <M extends string>(
  moduleName: string,
  member: MemberExpression,
  table: ImportTable<M>,
): Option.Option<ModuleObject<M>> =>
  Option.map(moduleNameFromName(moduleName, table.modules), (module) => ({ module, access: member }))

const namedModuleObject = <M extends string>(
  binding: NamespaceBinding<M>,
  moduleName: string,
  member: MemberExpression,
): Option.Option<ModuleObject<M>> =>
  binding.kind === 'module'
    ? Option.map(onlyWhen(binding.module === moduleName, member), (access) => ({ module: binding.module, access }))
    : Option.none()

const moduleOf = <M extends string>(binding: NamespaceBinding<M>): Option.Option<M> =>
  binding.kind === 'module' ? Option.some(binding.module) : Option.none()

const namespaceOf = <M extends string>(
  expression: Expression,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<NamespaceBinding<M>> =>
  Match.value(expression).pipe(
    Match.when(isIdentifier, (reference) =>
      Option.flatMap(Option.fromNullishOr(table.namespaces.get(reference.name)), (binding) =>
        Option.map(unshadowedName(reference.name, context), () =>
          binding))),
    Match.orElse(() =>
      Option.none()
    ),
  )

const moduleAccessFunctionDataFirst = <M extends string>(
  callee: Callee<M>,
  context: MutatorContext,
  table: ImportTable<M>,
): (module: M) => Option.Option<Expression> =>
(module) =>
  Arr.findFirst(
    [
      ownerAccessFor(callee, module),
      namedModuleAccess(module, context, table),
      rootNamespaceAccess(module, context, table),
      moduleNamespaceAccess(module, context, table),
    ],
    Option.isSome,
  ).pipe(Option.flatten)

export const moduleAccessFunction: {
  <M extends string>(
    callee: Callee<M>,
    context: MutatorContext,
    table: ImportTable<M>,
  ): (module: M) => Option.Option<Expression>
  <M extends string>(
    context: MutatorContext,
    table: ImportTable<M>,
  ): (callee: Callee<M>) => (module: M) => Option.Option<Expression>
} = dual((args: IArguments): boolean => args.length >= 3, moduleAccessFunctionDataFirst)

const ownerAccessFor = <M extends string>(callee: Callee<M>, module: M): Option.Option<Expression> =>
  Option.flatMap(callee.owner, (owner) => onlyWhen(owner.module === module, owner.access))

const namedModuleAccess = <M extends string>(
  module: M,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<Expression> =>
  Option.map(
    Option.fromNullishOr(
      table.moduleBindings.entries().find(([local, bound]) => Bool.and(bound === module, isVisible(local, context))),
    ),
    ([local]) => identifier(local),
  )

const rootNamespaceAccess = <M extends string>(
  module: M,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<Expression> =>
  Option.map(
    Option.fromNullishOr(
      table.namespaces.entries().find(([local, binding]) =>
        Bool.and(binding.kind === 'root', isVisible(local, context))
      ),
    ),
    ([local]) => memberExpression(identifier(local), identifier(module), false),
  )

const moduleNamespaceAccess = <M extends string>(
  module: M,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<Expression> =>
  Option.map(
    Option.fromNullishOr(
      table.namespaces.entries().find(([local, binding]) =>
        Option.exists(moduleOf(binding), (bound) => bound === module) && isVisible(local, context)
      ),
    ),
    ([local]) => identifier(local),
  )

const isEffectPipeCallDataFirst = <M extends string>(
  parent: CallExpression,
  context: MutatorContext,
  table: ImportTable<M>,
): boolean =>
  Match.value(parent.callee).pipe(
    Match.when(
      isIdentifier,
      (reference) => Bool.and(isVisible(reference.name, context), table.pipeBindings.has(reference.name)),
    ),
    Match.when(
      isMemberExpression,
      (member) =>
        Option.exists(
          staticMemberName(member),
          (name) => Bool.and(name === 'pipe', isPipeNamespace(member.object, context, table)),
        ),
    ),
    Match.orElse(() => false),
  )

export const isEffectPipeCall: {
  <M extends string>(parent: CallExpression, context: MutatorContext, table: ImportTable<M>): boolean
  <M extends string>(context: MutatorContext, table: ImportTable<M>): (parent: CallExpression) => boolean
} = dual((args: IArguments): boolean => args.length >= 3, isEffectPipeCallDataFirst)

const isPipeNamespace = <M extends string>(
  expression: Expression,
  context: MutatorContext,
  table: ImportTable<M>,
): boolean =>
  Match.value(expression).pipe(
    Match.when(isIdentifier, (reference) =>
      Option.match(namespaceOf(expression, context, table), {
        onNone: () => false,
        onSome: (binding) => Bool.and(isPipeNamespaceBinding(binding), isVisible(reference.name, context)),
      })),
    Match.orElse(() => false),
  )

const isPipeNamespaceBinding = <M extends string>(binding: NamespaceBinding<M>): boolean =>
  Match.value(binding.kind).pipe(
    Match.when((kind) => kind === 'root', () => true),
    Match.when((kind) => kind === 'functionModule', () => true),
    Match.orElse(() => false),
  )

export interface ResolvedEffectExport<M extends string = EffectModuleName> {
  readonly module: M
  readonly exportName: string
}

const resolveImportedExportDataFirst = <M extends string>(
  node: Expression,
  context: MutatorContext,
  table: ImportTable<M>,
): Option.Option<ResolvedEffectExport<M>> =>
  Option.map(
    resolveCallee(node, context, table),
    (callee): ResolvedEffectExport<M> => ({ module: callee.module, exportName: callee.exportName }),
  )

export const resolveImportedExport: {
  <M extends string>(
    node: Expression,
    context: MutatorContext,
    table: ImportTable<M>,
  ): Option.Option<ResolvedEffectExport<M>>
  <M extends string>(
    context: MutatorContext,
    table: ImportTable<M>,
  ): (node: Expression) => Option.Option<ResolvedEffectExport<M>>
} = dual((args: IArguments): boolean => args.length >= 3, resolveImportedExportDataFirst)

const isImportedLocalDataFirst = <M extends string>(name: string, table: ImportTable<M>): boolean =>
  table.valueLocals.has(name)

export const isImportedLocal: {
  <M extends string>(name: string, table: ImportTable<M>): boolean
  <M extends string>(table: ImportTable<M>): (name: string) => boolean
} = dual((args: IArguments): boolean => args.length >= 2, isImportedLocalDataFirst)

const isShadowedDataFirst = (name: string, context: MutatorContext): boolean =>
  context.ancestors.some((ancestor) => scopeDeclares(ancestor, name))

export const isShadowed: {
  (name: string, context: MutatorContext): boolean
  (context: MutatorContext): (name: string) => boolean
} = dual((args: IArguments): boolean => args.length >= 2, isShadowedDataFirst)

const isVisible = (name: string, context: MutatorContext): boolean => isShadowedDataFirst(name, context) === false

const unshadowedName = (name: string, context: MutatorContext): Option.Option<string> =>
  onlyWhen(isVisible(name, context), name)

const scopeDeclares = (ancestor: Node, name: string): boolean =>
  Match.value(ancestor).pipe(
    Match.when(isProgram, (program) => statementsDeclare(program.body, name)),
    Match.when(isBlockStatement, (block) => statementsDeclare(block.body, name)),
    Match.when(isStaticBlock, (block) => statementsDeclare(block.body, name)),
    Match.when(isTSModuleBlock, (block) => statementsDeclare(block.body, name)),
    Match.when(isSwitchStatement, (statement) =>
      statement.cases.some((caseClause) => statementsDeclare(caseClause.consequent, name))),
    Match.when(isFunctionLike, (fn) =>
      functionDeclares(fn, name)),
    Match.when(isCatchClause, (clause) => patternDeclaresOr(clause.param, name)),
    Match.when(isForStatement, (statement) => variableDeclarationDeclaresOr(statement.init, name)),
    Match.when(isForInStatement, (statement) => variableDeclarationDeclaresOr(statement.left, name)),
    Match.when(isForOfStatement, (statement) => variableDeclarationDeclaresOr(statement.left, name)),
    Match.when(isClassLike, (cls) => declaresIdentifier(cls.id, name)),
    Match.orElse(() => false),
  )

const functionDeclares = (fn: FunctionLike, name: string): boolean =>
  holdsAny([
    fn.params.some((param: ParamPattern) => patternDeclaresOr(param, name)),
    declaresIdentifier(fn.id, name),
    blockBodyDeclaresHoistedVar(fn.body, name),
  ])

const blockBodyDeclaresHoistedVar = (body: Node | null | undefined, name: string): boolean =>
  Option.match(Option.fromNullishOr(body), {
    onNone: () => false,
    onSome: (present) =>
      Match.value(present).pipe(
        Match.when(isBlockStatement, (block) => hoistedVarsDeclare(block, name)),
        Match.orElse(() => false),
      ),
  })

const hoistedVarsDeclare = (block: BlockStatement, name: string): boolean =>
  nodesOutsideFunctions(block).some((candidate) => hoistedCandidateDeclares(candidate, name))

const hoistedCandidateDeclares = (candidate: Node, name: string): boolean =>
  Match.value(candidate).pipe(
    Match.when(isVariableDeclaration, (declaration) =>
      Bool.and(declaration.kind === 'var', statementBindingsDeclare(declaration, name))),
    Match.orElse(() =>
      false
    ),
  )

const statementsDeclare = (statements: readonly Node[], name: string): boolean =>
  statements.some((statement) => statementDeclares(statement, name))

const statementDeclares = (statement: Node, name: string): boolean =>
  Match.value(statement).pipe(
    Match.when(isVariableDeclaration, (declaration) => statementBindingsDeclare(declaration, name)),
    Match.when(isFunctionDeclaration, (declaration) => declaresIdentifier(declaration.id, name)),
    Match.when(isClassLike, (declaration) => declaresIdentifier(declaration.id, name)),
    Match.when(isTSEnumDeclaration, (declaration) => declaration.id.name === name),
    Match.when(isTSModuleDeclaration, (declaration) => moduleDeclarationDeclares(declaration, name)),
    Match.when(isTSImportEqualsDeclaration, (declaration) => importEqualsDeclares(declaration, name)),
    Match.when(isExportNamedDeclaration, (declaration) =>
      Option.exists(Option.fromNullishOr(declaration.declaration), (inner) =>
        statementDeclares(inner, name))),
    Match.orElse(() =>
      false
    ),
  )

const statementBindingsDeclare = (declaration: VariableDeclaration, name: string): boolean =>
  declaration.declarations.some((declarator) => patternDeclaresOr(declarator.id, name))

const variableDeclarationDeclaresOr = (node: Node | null | undefined, name: string): boolean =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => false,
    onSome: (present) =>
      Match.value(present).pipe(
        Match.when(isVariableDeclaration, (declaration) => statementBindingsDeclare(declaration, name)),
        Match.orElse(() => false),
      ),
  })

const moduleDeclarationDeclares = (declaration: TSModuleDeclaration, name: string): boolean =>
  Bool.and(
    declaration.body !== null,
    Option.exists(identifierText(declaration.id), (text) => text === name),
  )

const importEqualsDeclares = (declaration: TSImportEqualsDeclaration, name: string): boolean =>
  Bool.and(declaration.importKind !== 'type', declaration.id.name === name)

const declaresIdentifier = (id: Node | null | undefined, name: string): boolean =>
  Option.exists(identifierText(id), (text) => text === name)

type BindingIdentifierPattern = Extract<BindingPattern, { readonly type: 'Identifier' }>

type ObjectBindingPattern = Extract<BindingPattern, { readonly type: 'ObjectPattern' }>

type ArrayBindingPattern = Extract<BindingPattern, { readonly type: 'ArrayPattern' }>

type AssignmentBindingPattern = Extract<BindingPattern, { readonly type: 'AssignmentPattern' }>

const patternDeclaresOr = (pattern: Node | null | undefined, name: string): boolean =>
  Option.match(Option.fromNullishOr(pattern), {
    onNone: () => false,
    onSome: (present) =>
      Match.value(present).pipe(
        Match.when(isBindingIdentifierPattern, (binding) => binding.name === name),
        Match.when(isObjectBindingPattern, (object) =>
          object.properties.some((property) => propertyDeclares(property, name))),
        Match.when(isArrayBindingPattern, (array) =>
          array.elements.some((element) => patternDeclaresOr(element, name))),
        Match.when(isAssignmentBindingPattern, (assignment) => patternDeclaresOr(assignment.left, name)),
        Match.when(isBindingRestElement, (rest) => patternDeclaresOr(rest.argument, name)),
        Match.orElse(() => false),
      ),
  })

const propertyDeclares = (property: Node, name: string): boolean =>
  Match.value(property).pipe(
    Match.when(isBindingProperty, (binding) => patternDeclaresOr(binding.value, name)),
    Match.when(isBindingRestElement, (rest) => patternDeclaresOr(rest.argument, name)),
    Match.orElse(() => false),
  )

const isBindingIdentifierPattern = (candidate: Node): candidate is BindingIdentifierPattern =>
  nodeType(candidate) === 'Identifier'

const isObjectBindingPattern = (candidate: Node): candidate is ObjectBindingPattern =>
  nodeType(candidate) === 'ObjectPattern'

const isArrayBindingPattern = (candidate: Node): candidate is ArrayBindingPattern =>
  nodeType(candidate) === 'ArrayPattern'

const isAssignmentBindingPattern = (candidate: Node): candidate is AssignmentBindingPattern =>
  nodeType(candidate) === 'AssignmentPattern'

const isBindingRestElement = (candidate: Node): candidate is BindingRestElement => nodeType(candidate) === 'RestElement'

const isBindingProperty = (candidate: Node): candidate is BindingProperty => nodeType(candidate) === 'Property'

export const identifierText = (node: Node | null | undefined): Option.Option<string> =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => Option.none(),
    onSome: (present) =>
      Match.value(present).pipe(
        Match.when(isNamedIdentifier, (name) => Option.some(name.name)),
        Match.when(isStringLiteral, (literal) => literalValueText(literal.value)),
        Match.orElse(() => Option.none()),
      ),
  })

const literalValueText = (value: string | number | boolean | bigint | RegExp | null): Option.Option<string> =>
  Match.value(value).pipe(
    Match.when(Predicate.isString, (text) => Option.some(text)),
    Match.orElse(() => Option.none()),
  )

const moduleExportName = (name: Node): string => Option.getOrElse(identifierText(name), () => '')

export const staticMemberName = (member: MemberExpression): Option.Option<string> =>
  Match.value(member.computed).pipe(
    Match.when(false, () => identifierText(member.property)),
    Match.orElse(() => Option.none()),
  )

export const nodesOutsideFunctions = (root: Node): readonly Node[] => {
  const collected: Node[] = []
  traverse(make(root), {
    enter(path) {
      collected.push(path.node)
      pruneAtFunction(path)
    },
  })
  return collected
}

const pruneAtFunction = (path: TraversePath): void =>
  Option.match(onlyWhen(isFunctionLike(path.node), path), {
    onNone: () => undefined,
    onSome: (atFunction) => atFunction.skip(),
  })

const onlyWhenDataFirst = <A>(holds: boolean, value: A): Option.Option<A> =>
  Match.value(holds).pipe(
    Match.when(true, () => Option.some(value)),
    Match.orElse(() => Option.none()),
  )

export const onlyWhen: {
  <A>(holds: boolean, value: A): Option.Option<A>
  <A>(value: A): (holds: boolean) => Option.Option<A>
} = dual((args: IArguments): boolean => args.length >= 2, onlyWhenDataFirst)

const holdsAny = (conditions: readonly boolean[]): boolean => conditions.some((condition) => condition)

type FunctionLike = Function | ArrowFunctionExpression
type ParamPattern = Function['params'][number]

const FUNCTION_KINDS: Readonly<Record<string, true>> = {
  ArrowFunctionExpression: true,
  FunctionDeclaration: true,
  FunctionExpression: true,
}

const CLASS_KINDS: Readonly<Record<string, true>> = {
  ClassDeclaration: true,
  ClassExpression: true,
}

export const isFunctionLike = (candidate: Node): candidate is FunctionLike =>
  FUNCTION_KINDS[nodeType(candidate) ?? ''] === true

const isClassLike = (candidate: Node): candidate is Class => CLASS_KINDS[nodeType(candidate) ?? ''] === true

export const isProgram = (candidate: Node): candidate is Program => nodeType(candidate) === 'Program'
const isBlockStatement = (candidate: Node): candidate is BlockStatement => nodeType(candidate) === 'BlockStatement'
const isStaticBlock = (candidate: Node): candidate is StaticBlock => nodeType(candidate) === 'StaticBlock'
const isTSModuleBlock = (candidate: Node): candidate is TSModuleBlock => nodeType(candidate) === 'TSModuleBlock'
const isSwitchStatement = (candidate: Node): candidate is SwitchStatement => nodeType(candidate) === 'SwitchStatement'
const isCatchClause = (candidate: Node): candidate is CatchClause => nodeType(candidate) === 'CatchClause'
const isForStatement = (candidate: Node): candidate is ForStatement => nodeType(candidate) === 'ForStatement'
const isForInStatement = (candidate: Node): candidate is ForInStatement => nodeType(candidate) === 'ForInStatement'
const isForOfStatement = (candidate: Node): candidate is ForOfStatement => nodeType(candidate) === 'ForOfStatement'
const isVariableDeclaration = (candidate: Node): candidate is VariableDeclaration =>
  nodeType(candidate) === 'VariableDeclaration'
const isFunctionDeclaration = (candidate: Node): candidate is Function => nodeType(candidate) === 'FunctionDeclaration'
const isTSEnumDeclaration = (candidate: Node): candidate is TSEnumDeclaration =>
  nodeType(candidate) === 'TSEnumDeclaration'
const isTSModuleDeclaration = (candidate: Node): candidate is TSModuleDeclaration =>
  nodeType(candidate) === 'TSModuleDeclaration'
const isTSImportEqualsDeclaration = (candidate: Node): candidate is TSImportEqualsDeclaration =>
  nodeType(candidate) === 'TSImportEqualsDeclaration'
const isExportNamedDeclaration = (candidate: Node): candidate is ExportNamedDeclaration =>
  nodeType(candidate) === 'ExportNamedDeclaration'
const isImportDeclaration = (candidate: Node): candidate is ImportDeclaration =>
  nodeType(candidate) === 'ImportDeclaration'
const isNamedImportSpecifier = (candidate: ImportSpecifierUnion): candidate is NamedImportSpecifier =>
  nodeType(candidate) === 'ImportSpecifier'
const isNamespaceImportSpecifier = (
  candidate: ImportSpecifierUnion,
): candidate is NamespaceImportSpecifier => nodeType(candidate) === 'ImportNamespaceSpecifier'
export const isCallExpression = (candidate: Node): candidate is CallExpression =>
  nodeType(candidate) === 'CallExpression'
export const isMemberExpression = (candidate: Node): candidate is MemberExpression =>
  nodeType(candidate) === 'MemberExpression'
export const isIdentifier = (candidate: Node): candidate is IdentifierReference => nodeType(candidate) === 'Identifier'
const isNamedIdentifier = (candidate: Node): candidate is IdentifierName => nodeType(candidate) === 'Identifier'
export const isThisExpression = (candidate: Node): candidate is ThisExpression =>
  nodeType(candidate) === 'ThisExpression'
export const isLiteral = (candidate: Node): candidate is Literal => nodeType(candidate) === 'Literal'
const isStringLiteral = (candidate: Node): candidate is StringLiteral => nodeType(candidate) === 'Literal'
