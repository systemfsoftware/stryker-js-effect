import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { Expression, Node } from './Ast.js'
import { arrowFunctionExpression, callExpression, cloneNode, identifier, memberExpression } from './Ast.js'
import {
  type EffectModuleName,
  freshIdentifier,
  identifiersIn,
  isMovableArgument,
  type ResolvedEffectCall,
  resolveEffectCall,
} from './EffectCall.js'
import type { Mutator } from './Mutator.js'

const NO_MUTANTS: readonly Node[] = []

const ATOMIC_UPDATE_SPLIT_MODULES: readonly EffectModuleName[] = ['Ref', 'SynchronizedRef']

const ATOMIC_UPDATE_SPLIT_OPERATIONS: readonly string[] = [
  'modify',
  'modifySome',
  'update',
  'updateSome',
  'updateAndGet',
  'getAndUpdate',
]

export const atomicUpdateSplitMutator: Mutator = (node, context) =>
  Option.match(resolveEffectCall(node, context), {
    onNone: () => NO_MUTANTS,
    onSome: (call) => Option.toArray(atomicUpdateSplitReplacement(call)),
  })

interface SplitOperation {
  readonly effectModule: Expression
  readonly operationModule: Expression
  readonly exportName: string
  readonly ref: Option.Option<Expression>
  readonly f: Expression
  readonly binders: SplitBinders
}

interface SplitBinders {
  readonly self: string
  readonly s: string
  readonly snap: string
  readonly b: string
  readonly a: string
}

interface SplitArguments {
  readonly ref: Option.Option<Expression>
  readonly f: Expression
}

interface ModuleBindings {
  readonly effectModule: Expression
  readonly operationModule: Expression
}

const atomicUpdateSplitReplacement = (call: ResolvedEffectCall): Option.Option<Expression> =>
  Option.flatMap(splitOperation(call), (operation) => Option.some(replacementExpression(operation)))

const splitOperation = (call: ResolvedEffectCall): Option.Option<SplitOperation> =>
  Match.value(call).pipe(
    Match.when(isAtomicUpdateSplitOperation, (covered) => splitOperationOf(covered)),
    Match.orElse(() => Option.none()),
  )

const isAtomicUpdateSplitOperation = (call: ResolvedEffectCall): boolean =>
  bothHold(
    included(ATOMIC_UPDATE_SPLIT_MODULES, call.module),
    included(ATOMIC_UPDATE_SPLIT_OPERATIONS, call.exportName),
  )

const splitOperationOf = (call: ResolvedEffectCall): Option.Option<SplitOperation> =>
  Option.flatMap(moduleBindings(call), (bindings) =>
    Option.flatMap(splitArguments(call), (args) =>
      Option.some({
        effectModule: bindings.effectModule,
        operationModule: bindings.operationModule,
        exportName: call.exportName,
        ref: args.ref,
        f: args.f,
        binders: freshBinders(takenNames(call, bindings, args.f)),
      })))

const splitArguments = (call: ResolvedEffectCall): Option.Option<SplitArguments> =>
  Match.value(call.form).pipe(
    Match.when((form) => form === 'data-first', () => dataFirstArguments(call)),
    Match.when((form) => form === 'piped-reference', () => Option.none<SplitArguments>()),
    Match.orElse(() => dataLastArguments(call)),
  )

const dataFirstArguments = (call: ResolvedEffectCall): Option.Option<SplitArguments> =>
  Option.flatMap(
    Arr.get(call.args, 0),
    (ref) =>
      Option.flatMap(Arr.get(call.args, 1), (f) =>
        onlyWhen(bothHold(isMovableArgument(ref), isMovableArgument(f)), {
          ref: Option.some(cloneNode(ref)),
          f: cloneNode(f),
        })),
  )

const dataLastArguments = (call: ResolvedEffectCall): Option.Option<SplitArguments> =>
  Option.flatMap(Arr.get(call.args, 0), (f) => onlyWhen(isMovableArgument(f), { ref: Option.none(), f: cloneNode(f) }))

const moduleBindings = (call: ResolvedEffectCall): Option.Option<ModuleBindings> =>
  Option.flatMap(
    call.moduleAccess('Effect'),
    (effectModule) =>
      Option.map(call.moduleAccess(call.module), (operationModule) => ({ effectModule, operationModule })),
  )

const takenNames = (
  call: ResolvedEffectCall,
  bindings: ModuleBindings,
  f: Expression,
): ReadonlySet<string> =>
  new Set([
    ...call.args.flatMap((argument) => identifiersIn(argument)),
    ...identifiersIn(f),
    ...identifiersIn(bindings.effectModule),
    ...identifiersIn(bindings.operationModule),
  ])

const freshBinders = (taken: ReadonlySet<string>): SplitBinders => ({
  self: freshIdentifier('self', taken),
  s: freshIdentifier('s', taken),
  snap: freshIdentifier('snap', taken),
  b: freshIdentifier('b', taken),
  a: freshIdentifier('a', taken),
})

const replacementExpression = (operation: SplitOperation): Expression =>
  Option.match(operation.ref, {
    onNone: () => arrowFunctionExpression([identifier(operation.binders.self)], splitBody(operation)),
    onSome: (ref) =>
      memberCall(operation.effectModule, 'flatMap', [
        memberCall(operation.effectModule, 'succeed', [ref]),
        arrowFunctionExpression([identifier(operation.binders.self)], splitBody(operation)),
      ]),
  })

const splitBody = (operation: SplitOperation): Expression =>
  memberCall(operation.effectModule, 'flatMap', [
    memberCall(operation.operationModule, 'get', [identifier(operation.binders.self)]),
    arrowFunctionExpression(
      [identifier(operation.binders.s)],
      memberCall(operation.effectModule, 'flatMap', [
        memberCall(operation.operationModule, 'make', [identifier(operation.binders.s)]),
        arrowFunctionExpression(
          [identifier(operation.binders.snap)],
          memberCall(operation.effectModule, 'flatMap', [
            memberCall(operation.operationModule, operation.exportName, [
              identifier(operation.binders.snap),
              operation.f,
            ]),
            arrowFunctionExpression(
              [identifier(operation.binders.b)],
              memberCall(operation.effectModule, 'flatMap', [
                moduleMember(operation.effectModule, 'yieldNow'),
                arrowFunctionExpression(
                  [],
                  memberCall(operation.effectModule, 'flatMap', [
                    memberCall(operation.operationModule, 'get', [identifier(operation.binders.snap)]),
                    arrowFunctionExpression(
                      [identifier(operation.binders.a)],
                      memberCall(operation.effectModule, 'as', [
                        memberCall(operation.operationModule, 'set', [
                          identifier(operation.binders.self),
                          identifier(operation.binders.a),
                        ]),
                        identifier(operation.binders.b),
                      ]),
                    ),
                  ]),
                ),
              ]),
            ),
          ]),
        ),
      ]),
    ),
  ])

const memberCall = (object: Expression, property: string, args: readonly Expression[]): Expression =>
  callExpression(moduleMember(object, property), args)

const moduleMember = (object: Expression, property: string): Expression =>
  memberExpression(object, identifier(property), false)

const included = <T>(values: readonly T[], value: T): boolean => values.includes(value)

const onlyWhen = <A>(holds: boolean, value: A): Option.Option<A> =>
  Match.value(holds).pipe(
    Match.when(true, () => Option.some(value)),
    Match.orElse(() => Option.none()),
  )

const bothHold = (first: boolean, second: boolean): boolean =>
  Match.value(first).pipe(Match.when(true, () => second), Match.orElse(() => false))
