/**
 * EffectCall — the resolution front half the opt-in concurrency mutators share.
 *
 * Given a visited node it answers: is this a covered Effect call (R1); through
 * which module and export did its callee resolve; which call form does its
 * argument count select (KTD10); does a data-last form sit where the replacement
 * function is contextually typed (R4); and how can each `effect` module the
 * replacement needs be reached from the file's own imports (KTD3). It decides
 * nothing about a replacement: a mutator asks for module access through the
 * description's `moduleAccess`, and gets none when the file has no unshadowed
 * binding for that module (R2).
 *
 * Pure. One expression per decision, no I/O, no throwing. The import table is
 * built once per Program and memoised in a WeakMap, because every visited node
 * asks for it and a file's imports never change mid-parse (KTD4).
 */
import type {
  Argument,
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
import {
  callExpression,
  identifier,
  make,
  memberExpression,
  nodeType,
  traverse,
  type TraversePath,
} from './Ast.handle.js'
import type { MutatorContext } from './Mutator.service.js'

export type EffectModuleName = 'Effect' | 'Ref' | 'Semaphore' | 'SynchronizedRef'

export type EffectCallForm =
  | 'data-first'
  | 'data-last-pipe-arg'
  | 'data-last-pipe-method'
  | 'data-last-immediate'
  | 'piped-reference'

export interface ResolvedEffectCall {
  readonly module: EffectModuleName
  readonly exportName: string
  readonly form: EffectCallForm
  readonly args: readonly Expression[]
  readonly moduleAccess: (module: EffectModuleName) => Option.Option<Expression>
}

const MODULE_NAMES: readonly EffectModuleName[] = ['Effect', 'Ref', 'Semaphore', 'SynchronizedRef']

const EFFECT_SOURCE = 'effect'
const FUNCTION_SOURCE = 'effect/Function'

const DATA_FIRST: EffectCallForm = 'data-first'
const DATA_LAST_PIPE_ARG: EffectCallForm = 'data-last-pipe-arg'
const DATA_LAST_PIPE_METHOD: EffectCallForm = 'data-last-pipe-method'
const DATA_LAST_IMMEDIATE: EffectCallForm = 'data-last-immediate'
const PIPED_REFERENCE: EffectCallForm = 'piped-reference'

const NO_ARGUMENTS: readonly Expression[] = Object.freeze([])

const ARITIES: Readonly<Record<string, Arity>> = Object.freeze({
  'Ref.modify': { dataFirst: [2], dataLast: 1 },
  'Ref.modifySome': { dataFirst: [2], dataLast: 1 },
  'Ref.update': { dataFirst: [2], dataLast: 1 },
  'Ref.updateSome': { dataFirst: [2], dataLast: 1 },
  'Ref.updateAndGet': { dataFirst: [2], dataLast: 1 },
  'Ref.getAndUpdate': { dataFirst: [2], dataLast: 1 },
  'SynchronizedRef.modify': { dataFirst: [2], dataLast: 1 },
  'SynchronizedRef.modifySome': { dataFirst: [2], dataLast: 1 },
  'SynchronizedRef.update': { dataFirst: [2], dataLast: 1 },
  'SynchronizedRef.updateSome': { dataFirst: [2], dataLast: 1 },
  'SynchronizedRef.updateAndGet': { dataFirst: [2], dataLast: 1 },
  'SynchronizedRef.getAndUpdate': { dataFirst: [2], dataLast: 1 },
  'Semaphore.withPermits': { dataFirst: [3], dataLast: 2 },
  'Semaphore.withPermit': { dataFirst: [2], dataLast: 1 },
  'Effect.ensuring': { dataFirst: [2], dataLast: 1 },
  'Effect.onExit': { dataFirst: [2], dataLast: 1 },
  'Effect.onError': { dataFirst: [2], dataLast: 1 },
  'Effect.onInterrupt': { dataFirst: [2], dataLast: 1 },
  'Effect.uninterruptible': { dataFirst: [1] },
  'Effect.uninterruptibleMask': { dataFirst: [1] },
  'Effect.acquireRelease': { dataFirst: [2, 3] },
  'Effect.acquireUseRelease': { dataFirst: [3] },
})

interface Arity {
  readonly dataFirst: readonly number[]
  readonly dataLast?: number
}

type ImportSpecifierUnion = ImportDeclaration['specifiers'][number]

type NamedImportSpecifier = Extract<ImportSpecifierUnion, { readonly type: 'ImportSpecifier' }>

type NamespaceImportSpecifier = Extract<ImportSpecifierUnion, { readonly type: 'ImportNamespaceSpecifier' }>

type NamespaceBinding =
  | { readonly kind: 'root' }
  | { readonly kind: 'functionModule' }
  | { readonly kind: 'module'; readonly module: EffectModuleName }

interface BareFunctionBinding {
  readonly module: EffectModuleName
  readonly exportName: string
}

interface ImportTable {
  readonly moduleBindings: ReadonlyMap<string, EffectModuleName>
  readonly namespaces: ReadonlyMap<string, NamespaceBinding>
  readonly bareFunctions: ReadonlyMap<string, BareFunctionBinding>
  readonly pipeBindings: ReadonlySet<string>
}

const EMPTY_IMPORT_TABLE: ImportTable = Object.freeze({
  moduleBindings: new Map<string, EffectModuleName>(),
  namespaces: new Map<string, NamespaceBinding>(),
  bareFunctions: new Map<string, BareFunctionBinding>(),
  pipeBindings: new Set<string>(),
})

type ImportContribution =
  | { readonly kind: 'module'; readonly local: string; readonly module: EffectModuleName }
  | { readonly kind: 'namespace'; readonly local: string; readonly binding: NamespaceBinding }
  | {
    readonly kind: 'bareFunction'
    readonly local: string
    readonly module: EffectModuleName
    readonly exportName: string
  }
  | { readonly kind: 'pipe'; readonly local: string }

const importTables = new WeakMap<Program, ImportTable>()

const importTableFor = (program: Program): ImportTable =>
  Option.getOrElse(Option.fromNullishOr(importTables.get(program)), () => rememberImportTable(program))

function rememberImportTable(program: Program): ImportTable {
  const table = buildImportTable(program)
  importTables.set(program, table)
  return table
}

const buildImportTable = (program: Program): ImportTable =>
  Arr.reduce(
    Arr.flatMap(Arr.filter(program.body, isImportDeclaration), importContributions),
    EMPTY_IMPORT_TABLE,
    applyContribution,
  )

const withEntry = <K, V>(entries: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> =>
  new Map([...entries, [key, value]])

const withMember = <V>(members: ReadonlySet<V>, value: V): ReadonlySet<V> => new Set([...members, value])

const applyContribution = (table: ImportTable, contribution: ImportContribution): ImportTable =>
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

const importContributions = (declaration: ImportDeclaration): readonly ImportContribution[] =>
  Option.toArray(onlyWhen(declaration.importKind !== 'type', declaration)).flatMap((imported) =>
    Arr.flatMap(
      imported.specifiers,
      (specifier) => Option.toArray(specifierContribution(imported.source.value, specifier)),
    )
  )

const specifierContribution = (
  source: string,
  specifier: ImportSpecifierUnion,
): Option.Option<ImportContribution> =>
  Match.value(specifier).pipe(
    Match.when(isNamedImportSpecifier, (named) => namedSpecifierContribution(source, named)),
    Match.when(isNamespaceImportSpecifier, (namespace) => namespaceSpecifierContribution(source, namespace)),
    Match.orElse(() => Option.none()),
  )

const namedSpecifierContribution = (
  source: string,
  specifier: NamedImportSpecifier,
): Option.Option<ImportContribution> =>
  onlyWhen(specifier.importKind !== 'type', specifier).pipe(
    Option.flatMap((imported) => namedContribution(source, moduleExportName(imported.imported), imported.local.name)),
  )

const namedContribution = (
  source: string,
  importedName: string,
  localName: string,
): Option.Option<ImportContribution> =>
  Match.value(source).pipe(
    Match.when((candidate) => candidate === EFFECT_SOURCE, () => effectRootContribution(importedName, localName)),
    Match.when((candidate) => candidate === FUNCTION_SOURCE, () => pipeContribution(importedName, localName)),
    Match.orElse(() =>
      Option.map(moduleNameFromSource(source), (module) => bareFunctionContribution(localName, module, importedName))
    ),
  )

const effectRootContribution = (importedName: string, localName: string): Option.Option<ImportContribution> =>
  Option.orElse(
    Option.map(moduleNameFromName(importedName), (module) => moduleContribution(localName, module)),
    () => pipeContribution(importedName, localName),
  )

const pipeContribution = (importedName: string, localName: string): Option.Option<ImportContribution> =>
  onlyWhen(importedName === 'pipe', pipeContributionOf(localName))

const namespaceSpecifierContribution = (
  source: string,
  specifier: NamespaceImportSpecifier,
): Option.Option<ImportContribution> =>
  Option.map(namespaceBindingFor(source), (binding) => ({
    kind: 'namespace',
    local: specifier.local.name,
    binding,
  }))

const moduleContribution = (local: string, module: EffectModuleName): ImportContribution => ({
  kind: 'module',
  local,
  module,
})

const bareFunctionContribution = (
  local: string,
  module: EffectModuleName,
  exportName: string,
): ImportContribution => ({ kind: 'bareFunction', local, module, exportName })

const pipeContributionOf = (local: string): ImportContribution => ({ kind: 'pipe', local })

const namespaceBindingFor = (source: string): Option.Option<NamespaceBinding> =>
  Match.value(source).pipe(
    Match.when((candidate) => candidate === EFFECT_SOURCE, () => Option.some<NamespaceBinding>({ kind: 'root' })),
    Match.when((candidate) => candidate === FUNCTION_SOURCE, () =>
      Option.some<NamespaceBinding>({ kind: 'functionModule' })),
    Match.orElse(() =>
      Option.map(moduleNameFromSource(source), (module): NamespaceBinding => ({ kind: 'module', module }))
    ),
  )

const moduleNameFromName = (name: string): Option.Option<EffectModuleName> =>
  Arr.findFirst(MODULE_NAMES, (module) => module === name)

const moduleNameFromSource = (source: string): Option.Option<EffectModuleName> =>
  Arr.findFirst(MODULE_NAMES, (module) => source === `${EFFECT_SOURCE}/${module}`)

interface Callee {
  readonly module: EffectModuleName
  readonly exportName: string
  readonly owner: Option.Option<ModuleObject>
}

interface ModuleObject {
  readonly module: EffectModuleName
  readonly access: Expression
}

const resolveEffectCallDataFirst = (
  node: Node,
  context: MutatorContext,
): Option.Option<ResolvedEffectCall> =>
  Option.flatMap(programOf(context), (program) => resolveIn(node, context, importTableFor(program)))

export const resolveEffectCall: {
  (node: Node, context: MutatorContext): Option.Option<ResolvedEffectCall>
  (context: MutatorContext): (node: Node) => Option.Option<ResolvedEffectCall>
} = dual((args: IArguments): boolean => args.length >= 2, resolveEffectCallDataFirst)

const programOf = (context: MutatorContext): Option.Option<Program> => Arr.findLast(context.ancestors, isProgram)

const resolveIn = (
  node: Node,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<ResolvedEffectCall> =>
  Match.value(node).pipe(
    Match.when(isCallExpression, (call) => resolveCall(call, context, table)),
    Match.when(isMemberExpression, (member) => resolveReference(member, context, table)),
    Match.when(isIdentifier, (reference) => resolveReference(reference, context, table)),
    Match.orElse(() => Option.none()),
  )

const resolveCall = (
  call: CallExpression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<ResolvedEffectCall> =>
  Option.flatMap(
    resolveCallee(call.callee, context, table),
    (callee) =>
      Option.flatMap(spreadFreeArguments(call.arguments), (args) =>
        Option.flatMap(callForm(callee, args, call, context, table), (form) =>
          Option.some({
            module: callee.module,
            exportName: callee.exportName,
            form,
            args,
            moduleAccess: moduleAccessFunction(callee, context, table),
          }))),
  )

const resolveReference = (
  reference: Expression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<ResolvedEffectCall> =>
  Option.flatMap(
    resolveCallee(reference, context, table),
    (callee) =>
      Option.flatMap(referenceForm(reference, context, table), (form) =>
        Option.some({
          module: callee.module,
          exportName: callee.exportName,
          form,
          args: NO_ARGUMENTS,
          moduleAccess: moduleAccessFunction(callee, context, table),
        })),
  )

const referenceForm = (
  reference: Expression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<EffectCallForm> =>
  Option.flatMap(
    parentCall(context),
    (parent) => Option.map(pipePosition(parent, reference, context, table), () => PIPED_REFERENCE),
  )

const spreadFreeArguments = (args: readonly Argument[]): Option.Option<readonly Expression[]> =>
  Match.value(args.some(isSpreadElement)).pipe(
    Match.when(true, (): Option.Option<readonly Expression[]> => Option.none()),
    Match.orElse(() => Option.some(args.filter(isSpreadFree))),
  )

const resolveCallee = (
  callee: Expression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<Callee> =>
  Match.value(callee).pipe(
    Match.when(isIdentifier, (reference) => resolveBareCallee(reference, context, table)),
    Match.when(isMemberExpression, (member) => resolveMemberCallee(member, context, table)),
    Match.orElse(() => Option.none()),
  )

const resolveBareCallee = (
  reference: IdentifierReference,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<Callee> =>
  Option.flatMap(
    Option.fromNullishOr(table.bareFunctions.get(reference.name)),
    (binding) =>
      Option.map(unshadowedName(reference.name, context), () => ({
        module: binding.module,
        exportName: binding.exportName,
        owner: Option.none<ModuleObject>(),
      })),
  )

const resolveMemberCallee = (
  member: MemberExpression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<Callee> =>
  Option.flatMap(
    staticMemberName(member),
    (exportName) =>
      Option.map(resolveModuleObject(member.object, context, table), (owner) => ({
        module: owner.module,
        exportName,
        owner: Option.some(owner),
      })),
  )

const resolveModuleObject = (
  expression: Expression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<ModuleObject> =>
  Match.value(expression).pipe(
    Match.when(isIdentifier, (reference) => identifierModuleObject(reference, context, table)),
    Match.when(isMemberExpression, (member) => namespacedModuleObject(member, context, table)),
    Match.orElse(() => Option.none()),
  )

const identifierModuleObject = (
  reference: IdentifierReference,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<ModuleObject> =>
  Option.orElse(
    Option.flatMap(Option.fromNullishOr(table.moduleBindings.get(reference.name)), (module) =>
      Option.map(unshadowedName(reference.name, context), () => ({ module, access: reference }))),
    () =>
      Option.flatMap(namespaceOf(reference, context, table), (binding) =>
        Option.map(moduleOf(binding), (module) => ({ module, access: reference }))),
  )

const namespacedModuleObject = (
  member: MemberExpression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<ModuleObject> =>
  Option.flatMap(
    staticMemberName(member),
    (moduleName) =>
      Option.flatMap(namespaceOf(member.object, context, table), (binding) =>
        Match.value(binding).pipe(
          Match.when(isRootNamespace, () =>
            Option.map(moduleNameFromName(moduleName), (module) => ({ module, access: member }))),
          Match.when(isModuleNamespace, (moduleNamespace) =>
            Option.map(onlyWhen(moduleNamespace.module === moduleName, member), (access) => ({
              module: moduleNamespace.module,
              access,
            }))),
          Match.orElse(() =>
            Option.none()
          ),
        )),
  )

const isRootNamespace = (binding: NamespaceBinding): binding is Extract<NamespaceBinding, { readonly kind: 'root' }> =>
  binding.kind === 'root'

const moduleOf = (binding: NamespaceBinding): Option.Option<EffectModuleName> =>
  Match.value(binding).pipe(
    Match.when(isModuleNamespace, (moduleNamespace) => Option.some(moduleNamespace.module)),
    Match.orElse(() => Option.none()),
  )

const isModuleNamespace = (
  binding: NamespaceBinding,
): binding is Extract<NamespaceBinding, { readonly kind: 'module' }> => binding.kind === 'module'

const namespaceOf = (
  expression: Expression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<NamespaceBinding> =>
  Match.value(expression).pipe(
    Match.when(isIdentifier, (reference) =>
      Option.flatMap(Option.fromNullishOr(table.namespaces.get(reference.name)), (binding) =>
        Option.map(unshadowedName(reference.name, context), () =>
          binding))),
    Match.orElse(() =>
      Option.none()
    ),
  )

const callForm = (
  callee: Callee,
  args: readonly Expression[],
  call: CallExpression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<EffectCallForm> =>
  Option.flatMap(arityOf(callee), (arity) =>
    Match.value(args.length).pipe(
      Match.when((count) => arity.dataFirst.includes(count), () => Option.some(DATA_FIRST)),
      Match.when((count) => arity.dataLast === count, () => dataLastForm(call, context, table)),
      Match.orElse(() => Option.none()),
    ))

const arityOf = (callee: Callee): Option.Option<Arity> =>
  Option.fromNullishOr(ARITIES[`${callee.module}.${callee.exportName}`])

const dataLastForm = (
  call: CallExpression,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<EffectCallForm> =>
  Option.flatMap(parentCall(context), (parent) =>
    Match.value(parent.callee === call).pipe(
      Match.when(true, () => Option.some(DATA_LAST_IMMEDIATE)),
      Match.orElse(() => Option.flatMap(pipePosition(parent, call, context, table), formForPosition)),
    ))

interface PipePosition {
  readonly index: number
  readonly callee: 'method' | 'effect'
}

const pipePosition = (
  parent: CallExpression,
  argument: Node,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<PipePosition> =>
  Option.flatMap(argumentIndex(parent.arguments, argument), (index) =>
    Option.orElse(
      onlyWhen<PipePosition>(isPipeMethodCall(parent), { index, callee: 'method' }),
      () => onlyWhen<PipePosition>(isEffectPipeCall(parent, context, table), { index, callee: 'effect' }),
    ))

const formForPosition = (position: PipePosition): Option.Option<EffectCallForm> =>
  Match.value(position.callee).pipe(
    Match.when((callee) => callee === 'method', () => Option.some(DATA_LAST_PIPE_METHOD)),
    Match.orElse(() => onlyWhen(position.index >= 1, DATA_LAST_PIPE_ARG)),
  )

const argumentIndex = (args: readonly Argument[], node: Node): Option.Option<number> =>
  Option.flatMap(
    Option.fromNullishOr(args.findIndex((argument) => sameNode(argument, node))),
    (index) => onlyWhen(index >= 0, index),
  )

const parentCall = (context: MutatorContext): Option.Option<CallExpression> =>
  Option.flatMap(Option.fromNullishOr(context.parent), (parent) =>
    Match.value(parent).pipe(
      Match.when(isCallExpression, (call) => Option.some(call)),
      Match.orElse(() => Option.none()),
    ))

const isPipeMethodCall = (parent: CallExpression): boolean =>
  Match.value(parent.callee).pipe(
    Match.when(isMemberExpression, (member) => Option.exists(staticMemberName(member), (name) => name === 'pipe')),
    Match.orElse(() => false),
  )

const isEffectPipeCall = (parent: CallExpression, context: MutatorContext, table: ImportTable): boolean =>
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

const isPipeNamespace = (expression: Expression, context: MutatorContext, table: ImportTable): boolean =>
  Match.value(expression).pipe(
    Match.when(isIdentifier, (reference) =>
      Option.match(namespaceOf(expression, context, table), {
        onNone: () => false,
        onSome: (binding) => Bool.and(isPipeNamespaceBinding(binding), isVisible(reference.name, context)),
      })),
    Match.orElse(() => false),
  )

const isPipeNamespaceBinding = (binding: NamespaceBinding): boolean =>
  Match.value(binding.kind).pipe(
    Match.when((kind) => kind === 'root', () => true),
    Match.when((kind) => kind === 'functionModule', () => true),
    Match.orElse(() => false),
  )

const moduleAccessFunction = (
  callee: Callee,
  context: MutatorContext,
  table: ImportTable,
): (module: EffectModuleName) => Option.Option<Expression> =>
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

const ownerAccessFor = (callee: Callee, module: EffectModuleName): Option.Option<Expression> =>
  Option.flatMap(callee.owner, (owner) => onlyWhen(owner.module === module, owner.access))

const namedModuleAccess = (
  module: EffectModuleName,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<Expression> =>
  Option.map(
    Option.fromNullishOr(
      table.moduleBindings.entries().find(([local, bound]) => Bool.and(bound === module, isVisible(local, context))),
    ),
    ([local]) => identifier(local),
  )

const rootNamespaceAccess = (
  module: EffectModuleName,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<Expression> =>
  Option.map(
    Option.fromNullishOr(
      table.namespaces.entries().find(([local, binding]) =>
        Bool.and(binding.kind === 'root', isVisible(local, context))
      ),
    ),
    ([local]) => memberExpression(identifier(local), identifier(module), false),
  )

const moduleNamespaceAccess = (
  module: EffectModuleName,
  context: MutatorContext,
  table: ImportTable,
): Option.Option<Expression> =>
  Option.map(
    Option.fromNullishOr(
      table.namespaces.entries().find(([local, binding]) =>
        Option.exists(moduleOf(binding), (bound) => bound === module) && isVisible(local, context)
      ),
    ),
    ([local]) => identifier(local),
  )

export const isMovableArgument = (node: Node): boolean =>
  nodesOutsideFunctions(node).every((candidate) => YIELD_OR_AWAIT_KINDS[nodeType(candidate) ?? ''] !== true)

const YIELD_OR_AWAIT_KINDS: Readonly<Record<string, true>> = {
  AwaitExpression: true,
  YieldExpression: true,
}

export const isDroppableArgument = (node: Node): boolean =>
  Match.value(node).pipe(
    Match.when(isIdentifier, () => true),
    Match.when(isLiteral, () => true),
    Match.when(isThisExpression, () => true),
    Match.when(isFunctionLike, () => true),
    Match.when(isMemberExpression, (member) => isCallFreeMemberChain(member)),
    Match.orElse(() => false),
  )

const isCallFreeMemberChain = (member: MemberExpression): boolean =>
  Match.value(member.computed).pipe(
    Match.when(true, () => false),
    Match.orElse(() =>
      Match.value(member.object).pipe(
        Match.when(isIdentifier, () => true),
        Match.when(isThisExpression, () => true),
        Match.when(isMemberExpression, (inner) => isCallFreeMemberChain(inner)),
        Match.orElse(() => false),
      )
    ),
  )

export const identifiersIn = (node: Node): readonly string[] =>
  allNodesUnder(node).flatMap((candidate) => Option.toArray(identifierText(candidate)))

const freshIdentifierDataFirst = (base: string, taken: ReadonlySet<string>): string => freeIdentifier(base, taken, 0)

export const freshIdentifier: {
  (base: string, taken: ReadonlySet<string>): string
  (taken: ReadonlySet<string>): (base: string) => string
} = dual((args: IArguments): boolean => args.length >= 2, freshIdentifierDataFirst)

const freeIdentifier = (base: string, taken: ReadonlySet<string>, suffix: number): string =>
  Match.value(taken.has(suffixedName(base, suffix))).pipe(
    Match.when(false, () => suffixedName(base, suffix)),
    Match.orElse(() => freeIdentifier(base, taken, suffix + 1)),
  )

const suffixedName = (base: string, suffix: number): string =>
  Match.value(suffix).pipe(Match.when(0, () => base), Match.orElse((count) => `${base}${count}`))

const isShadowed = (name: string, context: MutatorContext): boolean =>
  context.ancestors.some((ancestor) => scopeDeclares(ancestor, name))

const isVisible = (name: string, context: MutatorContext): boolean => isShadowed(name, context) === false

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

const identifierText = (node: Node | null | undefined): Option.Option<string> =>
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

const staticMemberName = (member: MemberExpression): Option.Option<string> =>
  Match.value(member.computed).pipe(
    Match.when(false, () => identifierText(member.property)),
    Match.orElse(() => Option.none()),
  )

const nodesOutsideFunctions = (root: Node): readonly Node[] => {
  const collected: Node[] = []
  traverse(make(root), {
    enter(path) {
      collected.push(path.node)
      pruneAtFunction(path)
    },
  })
  return collected
}

const allNodesUnder = (root: Node): readonly Node[] => {
  const collected: Node[] = []
  traverse(make(root), {
    enter(path) {
      collected.push(path.node)
    },
  })
  return collected
}

const pruneAtFunction = (path: TraversePath): void =>
  Option.match(onlyWhen(isFunctionLike(path.node), path), {
    onNone: () => undefined,
    onSome: (atFunction) => atFunction.skip(),
  })

const moduleCallDataFirst = (module: Expression, property: string, args: readonly Expression[]): Expression =>
  callExpression(memberExpression(module, identifier(property), false), args)

export const moduleCall: {
  (module: Expression, property: string, args: readonly Expression[]): Expression
  (property: string, args: readonly Expression[]): (module: Expression) => Expression
} = dual((args: IArguments): boolean => args.length >= 3, moduleCallDataFirst)

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

const sameNode = (first: Node, second: Node): boolean => first === second

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

const isFunctionLike = (candidate: Node): candidate is FunctionLike =>
  FUNCTION_KINDS[nodeType(candidate) ?? ''] === true

const isClassLike = (candidate: Node): candidate is Class => CLASS_KINDS[nodeType(candidate) ?? ''] === true

const isProgram = (candidate: Node): candidate is Program => nodeType(candidate) === 'Program'
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
const isCallExpression = (candidate: Node): candidate is CallExpression => nodeType(candidate) === 'CallExpression'
const isMemberExpression = (candidate: Node): candidate is MemberExpression =>
  nodeType(candidate) === 'MemberExpression'
const isIdentifier = (candidate: Node): candidate is IdentifierReference => nodeType(candidate) === 'Identifier'
const isNamedIdentifier = (candidate: Node): candidate is IdentifierName => nodeType(candidate) === 'Identifier'
const isThisExpression = (candidate: Node): candidate is ThisExpression => nodeType(candidate) === 'ThisExpression'
const isLiteral = (candidate: Node): candidate is Literal => nodeType(candidate) === 'Literal'
const isStringLiteral = (candidate: Node): candidate is StringLiteral => nodeType(candidate) === 'Literal'
const isSpreadElement = (argument: Argument): boolean => nodeType(argument) === 'SpreadElement'
const isSpreadFree = (argument: Argument): argument is Expression => nodeType(argument) !== 'SpreadElement'
