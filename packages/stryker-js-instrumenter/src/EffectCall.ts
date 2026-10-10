import type {
  Argument,
  CallExpression,
  Expression,
  MemberExpression,
  Node,
  Program,
} from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { callExpression, identifier, make, memberExpression, nodeType, traverse } from './Ast.handle.js'
import {
  buildImportTable,
  type Callee,
  type EffectModuleName,
  identifierText,
  type ImportTable,
  isCallExpression,
  isEffectPipeCall,
  isFunctionLike,
  isIdentifier,
  isLiteral,
  isMemberExpression,
  isProgram,
  isThisExpression,
  moduleAccessFunction,
  nodesOutsideFunctions,
  onlyWhen,
  resolveCallee,
  staticMemberName,
} from './effect-imports.js'
import type { MutatorContext } from './Mutator.service.js'

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

const resolveEffectCallDataFirst = (
  node: Node,
  context: MutatorContext,
): Option.Option<ResolvedEffectCall> =>
  Option.flatMap(programOf(context), (program) => resolveIn(node, context, buildImportTable(program, MODULE_NAMES)))

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

const allNodesUnder = (root: Node): readonly Node[] => {
  const collected: Node[] = []
  traverse(make(root), {
    enter(path) {
      collected.push(path.node)
    },
  })
  return collected
}

const moduleCallDataFirst = (module: Expression, property: string, args: readonly Expression[]): Expression =>
  callExpression(memberExpression(module, identifier(property), false), args)

export const moduleCall: {
  (module: Expression, property: string, args: readonly Expression[]): Expression
  (property: string, args: readonly Expression[]): (module: Expression) => Expression
} = dual((args: IArguments): boolean => args.length >= 3, moduleCallDataFirst)

const sameNode = (first: Node, second: Node): boolean => first === second

const isSpreadElement = (argument: Argument): boolean => nodeType(argument) === 'SpreadElement'
const isSpreadFree = (argument: Argument): argument is Expression => nodeType(argument) !== 'SpreadElement'
