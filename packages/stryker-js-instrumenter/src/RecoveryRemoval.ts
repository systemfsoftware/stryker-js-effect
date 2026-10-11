/**
 * RecoveryRemoval — the R15 mutants: one Effect recovery dropped, so the typed
 * failure it handled propagates.
 *
 * - `catch`, `catchTag`, `catchIf`, `catchFilter`, `catchReason`, and
 *   `orElseSucceed`: a data-first call becomes its first argument, the effect
 *   it recovered; a data-last call that a pipe or an immediate call takes
 *   becomes `(self) => self` (KTD12), so the pipe keeps its arity and typing.
 * - `catchTags` and `catchReasons`: one mutant per handler of the record
 *   literal, the call kept with that handler removed. A record that is not an
 *   object literal, or that spreads another record, yields none.
 *
 * Every argument a mutant drops must be droppable (KTD5): removing it skips no
 * evaluation the program relied on. A data-first call whose first argument is a
 * tag, a record, or a function written in place is a data-last call stored for
 * later, so it yields no mutant.
 *
 * Resolution lives in `EffectCall.ts`; this module never inspects imports.
 */
import type {
  ArrayExpression,
  CallExpression,
  Expression,
  Node,
  ObjectExpression,
  ObjectProperty,
} from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { cloneNode } from './Ast.handle.js'
import {
  identityFunction,
  isDroppableArgument,
  onlyWhen,
  type ResolvedEffectCall,
  resolveEffectCall,
} from './EffectCall.js'
import type { MutatorContext } from './Mutator.service.js'

const NO_MUTANTS: readonly Node[] = []

const WHOLE_CALL_RECOVERIES: Readonly<Record<string, true>> = {
  catch: true,
  catchTag: true,
  catchIf: true,
  catchFilter: true,
  catchReason: true,
  orElseSucceed: true,
}

const DATA_LAST_RECORD_INDEX: Readonly<Record<string, number>> = { catchTags: 0, catchReasons: 1 }

const STORED_DATA_LAST_HEADS: Readonly<Record<string, true>> = {
  Literal: true,
  TemplateLiteral: true,
  ArrayExpression: true,
  ObjectExpression: true,
  ArrowFunctionExpression: true,
  FunctionExpression: true,
}

const recoveryRemovalMutatorDataFirst = (node: Node, context: MutatorContext): readonly Node[] =>
  Match.value(node).pipe(
    Match.when(isCallExpression, (call) =>
      Option.match(resolveEffectCall(call, context), {
        onNone: () => NO_MUTANTS,
        onSome: (resolved) => recoveryRemovals(call, resolved),
      })),
    Match.orElse(() => NO_MUTANTS),
  )

export const recoveryRemovalMutator: {
  (node: Node, context: MutatorContext): readonly Node[]
  (context: MutatorContext): (node: Node) => readonly Node[]
} = dual((args: IArguments): boolean => args.length >= 2, recoveryRemovalMutatorDataFirst)

const recoveryRemovals = (node: CallExpression, call: ResolvedEffectCall): readonly Node[] =>
  Match.value(call).pipe(
    Match.when(isWholeCallRecovery, (recovery) => Option.toArray(unrecovered(recovery))),
    Match.when(isRecordRecovery, (recovery) => handlerRemovals(node, recovery)),
    Match.orElse(() => NO_MUTANTS),
  )

const isEffectRecovery = (call: ResolvedEffectCall): boolean =>
  Bool.every([call.module === 'Effect', call.form !== 'piped-reference', !isStoredDataLast(call)])

const isWholeCallRecovery = (call: ResolvedEffectCall): boolean =>
  isEffectRecovery(call) && WHOLE_CALL_RECOVERIES[call.exportName] === true

const isRecordRecovery = (call: ResolvedEffectCall): boolean =>
  isEffectRecovery(call) && Object.hasOwn(DATA_LAST_RECORD_INDEX, call.exportName)

const isStoredDataLast = (call: ResolvedEffectCall): boolean =>
  call.form === 'data-first' &&
  Option.exists(Arr.get(call.args, 0), (head) => STORED_DATA_LAST_HEADS[head.type] === true)

const unrecovered = (call: ResolvedEffectCall): Option.Option<Expression> =>
  Match.value(call.form).pipe(
    Match.when('data-first', () =>
      Option.flatMap(
        onlyWhen(call.args.slice(1).every(isDroppedFreely), call),
        (recovery) => Option.map(Arr.get(recovery.args, 0), (self) => cloneNode(self)),
      )),
    Match.orElse(() => onlyWhen(call.args.every(isDroppedFreely), identityFunction(call))),
  )

const handlerRemovals = (node: CallExpression, call: ResolvedEffectCall): readonly Node[] => {
  const recordIndex = recordIndexOf(call)
  return Option.match(Option.flatMap(Arr.get(call.args, recordIndex), handlerRecord), {
    onNone: () => NO_MUTANTS,
    onSome: (record) =>
      removableHandlerIndices(record).map((index) => callWithoutHandler(node, recordIndex, record, index)),
  })
}

const recordIndexOf = (call: ResolvedEffectCall): number =>
  Option.getOrElse(Option.fromUndefinedOr(DATA_LAST_RECORD_INDEX[call.exportName]), () => 0) +
  Number(call.form === 'data-first')

const removableHandlerIndices = (record: ObjectExpression): readonly number[] =>
  record.properties.flatMap((property, index) =>
    Option.toArray(Option.map(Option.liftPredicate(property, isRemovableHandler), () => index))
  )

const handlerRecord = (argument: Expression): Option.Option<ObjectExpression> =>
  Option.filter(
    Option.liftPredicate(argument, isObjectExpression),
    (record) => record.properties.every((property) => property.type === 'Property'),
  )

const isRemovableHandler = (property: ObjectExpression['properties'][number]): boolean =>
  Option.exists(
    Option.liftPredicate(property, isObjectProperty),
    (handler) =>
      Bool.and(isDroppableArgument(handler.value), Bool.or(!handler.computed, isDroppableArgument(handler.key))),
  )

const isObjectProperty = (property: ObjectExpression['properties'][number]): property is ObjectProperty =>
  property.type === 'Property'

const callWithoutHandler = (
  node: CallExpression,
  recordIndex: number,
  record: ObjectExpression,
  handlerIndex: number,
): CallExpression => {
  const copy = cloneNode(node)
  return { ...copy, arguments: copy.arguments.with(recordIndex, cloneNode(withoutProperty(record, handlerIndex))) }
}

const withoutProperty = (record: ObjectExpression, handlerIndex: number): ObjectExpression => ({
  ...record,
  properties: record.properties.filter((_, index) => index !== handlerIndex),
})

const isDroppedFreely = (argument: Node): boolean => Bool.or(isDroppableArgument(argument), isFreeArray(argument))

const isFreeArray = (argument: Node): boolean =>
  Option.exists(
    Option.liftPredicate(argument, isArrayExpression),
    (array) => array.elements.every((element) => Option.exists(Option.fromNullishOr(element), isDroppableArgument)),
  )

const isCallExpression = (node: Node): node is CallExpression => node.type === 'CallExpression'

const isObjectExpression = (node: Node): node is ObjectExpression => node.type === 'ObjectExpression'

const isArrayExpression = (node: Node): node is ArrayExpression => node.type === 'ArrayExpression'
