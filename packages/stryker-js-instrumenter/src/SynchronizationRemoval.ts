/**
 * SynchronizationRemoval — the R7 mutants: a removed lock and a removed mask.
 *
 * Four call shapes, each producing the wrapped effect alone:
 *
 * - `Semaphore.withPermits(sem, n, e)` and `Semaphore.withPermit(sem, e)` become
 *   the guarded effect. The guard arguments are dropped, so they must be
 *   droppable (KTD5); the effect itself is cloned so the mutant's tree shares
 *   nothing with the original's.
 * - Their data-last forms become `(self) => self`, which the resolver only
 *   reports where that function is contextually typed (R4, KTD9) — a piped
 *   argument, a piped method argument, or the callee of an immediate call.
 * - `Effect.uninterruptible(e)` becomes `e`, and a bare `Effect.uninterruptible`
 *   used as a pipe argument becomes `(self) => self` (KTD9).
 * - `Effect.uninterruptibleMask(f)` becomes `E.suspend(() => f(E.interruptible))`
 *   (KTD7): `f` is called at run time, as the original calls it, and the restore
 *   it receives is the identity wherever the surrounding region is interruptible.
 *   This needs the Effect module object in scope (R2, KTD3).
 *
 * Resolution lives in `EffectCall.ts`; this module never inspects imports. It is
 * a pure function from a resolved call to the one mutant it implies, and yields
 * no mutant whenever the replacement would evaluate an argument twice or lean on
 * a moved argument that can yield.
 */
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { Expression, Node } from './Ast.js'
import { arrowFunctionExpression, callExpression, cloneNode, identifier, memberExpression } from './Ast.js'
import {
  type EffectCallForm,
  freshIdentifier,
  identifiersIn,
  isDroppableArgument,
  isMovableArgument,
  moduleCall,
  onlyWhen,
  type ResolvedEffectCall,
  resolveEffectCall,
} from './EffectCall.js'
import type { Mutator } from './Mutator.js'

const NO_MUTANTS: readonly Node[] = []

export const synchronizationRemovalMutator: Mutator = (node, context) =>
  Option.match(resolveEffectCall(node, context), {
    onNone: () => NO_MUTANTS,
    onSome: (call) => Option.toArray(synchronizationRemovalReplacement(call)),
  })

const synchronizationRemovalReplacement = (call: ResolvedEffectCall): Option.Option<Expression> =>
  Match.value(call).pipe(
    Match.when(isWithPermits, withPermitsReplacement),
    Match.when(isWithPermit, withPermitReplacement),
    Match.when(isUninterruptible, uninterruptibleReplacement),
    Match.when(isUninterruptibleMask, uninterruptibleMaskReplacement),
    Match.orElse(() => Option.none()),
  )

const isWithPermits = (call: ResolvedEffectCall): boolean =>
  Bool.and(call.module === 'Semaphore', call.exportName === 'withPermits')

const isWithPermit = (call: ResolvedEffectCall): boolean =>
  Bool.and(call.module === 'Semaphore', call.exportName === 'withPermit')

const isUninterruptible = (call: ResolvedEffectCall): boolean =>
  Bool.and(call.module === 'Effect', call.exportName === 'uninterruptible')

const isUninterruptibleMask = (call: ResolvedEffectCall): boolean =>
  Bool.and(call.module === 'Effect', call.exportName === 'uninterruptibleMask')

const isDataFirst = (form: EffectCallForm): boolean => form === 'data-first'

const isPipedReference = (form: EffectCallForm): boolean => form === 'piped-reference'

const withPermitsReplacement = (call: ResolvedEffectCall): Option.Option<Expression> =>
  Match.value(call.form).pipe(
    Match.when(isDataFirst, () => whenDroppable(call, [0, 1], (guarded) => argumentReplacement(guarded, 2))),
    Match.orElse(() => whenDroppable(call, [0, 1], identityFunctionOf)),
  )

const withPermitReplacement = (call: ResolvedEffectCall): Option.Option<Expression> =>
  Match.value(call.form).pipe(
    Match.when(isDataFirst, () => whenDroppable(call, [0], (guarded) => argumentReplacement(guarded, 1))),
    Match.orElse(() => whenDroppable(call, [0], identityFunctionOf)),
  )

const uninterruptibleReplacement = (call: ResolvedEffectCall): Option.Option<Expression> =>
  Match.value(call.form).pipe(
    Match.when(isPipedReference, () => Option.some(identityFunction(call))),
    Match.orElse(() => argumentReplacement(call, 0)),
  )

const uninterruptibleMaskReplacement = (call: ResolvedEffectCall): Option.Option<Expression> =>
  whenMovable(call, [0], (masked) =>
    Option.flatMap(
      masked.moduleAccess('Effect'),
      (effectModule) => Option.map(Arr.get(masked.args, 0), (f) => maskedReplacement(effectModule, f)),
    ))

const maskedReplacement = (effectModule: Expression, f: Expression): Expression =>
  moduleCall(effectModule, 'suspend', [
    arrowFunctionExpression(
      [],
      callExpression(cloneNode(f), [
        memberExpression(effectModule, identifier('interruptible'), false),
      ]),
    ),
  ])

const argumentReplacement = (call: ResolvedEffectCall, index: number): Option.Option<Expression> =>
  Option.map(Arr.get(call.args, index), (argument) => cloneNode(argument))

const identityFunctionOf = (call: ResolvedEffectCall): Option.Option<Expression> => Option.some(identityFunction(call))

const identityFunction = (call: ResolvedEffectCall): Expression => {
  const name = freshIdentifier('self', takenNames(call))
  return arrowFunctionExpression([identifier(name)], identifier(name))
}

const takenNames = (call: ResolvedEffectCall): ReadonlySet<string> =>
  new Set(call.args.flatMap((argument) => identifiersIn(argument)))

const whenDroppable = (
  call: ResolvedEffectCall,
  indices: readonly number[],
  build: (call: ResolvedEffectCall) => Option.Option<Expression>,
): Option.Option<Expression> => Option.flatMap(onlyWhen(argumentsDroppable(call, indices), call), build)

const whenMovable = (
  call: ResolvedEffectCall,
  indices: readonly number[],
  build: (call: ResolvedEffectCall) => Option.Option<Expression>,
): Option.Option<Expression> => Option.flatMap(onlyWhen(argumentsMovable(call, indices), call), build)

const argumentsDroppable = (call: ResolvedEffectCall, indices: readonly number[]): boolean =>
  indices.every((index) => argumentSatisfies(call, index, isDroppableArgument))

const argumentsMovable = (call: ResolvedEffectCall, indices: readonly number[]): boolean =>
  indices.every((index) => argumentSatisfies(call, index, isMovableArgument))

const argumentSatisfies = (
  call: ResolvedEffectCall,
  index: number,
  predicate: (node: Node) => boolean,
): boolean => Option.exists(Arr.get(call.args, index), predicate)
