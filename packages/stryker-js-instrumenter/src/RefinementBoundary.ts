import type {
  BooleanLiteral,
  CallExpression,
  Expression,
  IdentifierName,
  Literal,
  Node,
  NumericLiteral,
  ObjectExpression,
  ObjectProperty,
  UnaryExpression,
} from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import {
  binaryExpression,
  booleanLiteral,
  callExpression,
  cloneNode,
  identifier,
  nodeType,
  numericLiteral,
  objectProperty,
} from './Ast.handle.js'
import { moduleCall, onlyWhen, type ResolvedEffectCall, resolveEffectCall } from './EffectCall.js'
import type { MutatorContext } from './Mutator.service.js'

type LengthShift = '+' | '-'

const INCLUSIVITY_SWAPS: Readonly<Record<string, string>> = Object.freeze({
  isGreaterThan: 'isGreaterThanOrEqualTo',
  isGreaterThanOrEqualTo: 'isGreaterThan',
  isLessThan: 'isLessThanOrEqualTo',
  isLessThanOrEqualTo: 'isLessThan',
})

const LENGTH_SHIFTS: Readonly<Record<string, LengthShift>> = Object.freeze({
  isMinLength: '+',
  isMaxLength: '-',
})

const EXCLUSIVITY_FLAGS: readonly string[] = ['exclusiveMinimum', 'exclusiveMaximum']

const refinementBoundaryMutatorDataFirst = (node: Node, context: MutatorContext): readonly Node[] =>
  Option.getOrElse(
    Option.flatMap(Option.liftPredicate(node, isCallExpression), (call) =>
      Option.map(Option.filter(resolveEffectCall(call, context), isDataFirstSchemaCall), (resolved) =>
        boundaryShifts(call, resolved))),
    (): readonly Node[] => [],
  )

export const refinementBoundaryMutator: {
  (node: Node, context: MutatorContext): readonly Node[]
  (context: MutatorContext): (node: Node) => readonly Node[]
} = dual((args: IArguments): boolean => args.length >= 2, refinementBoundaryMutatorDataFirst)

const isDataFirstSchemaCall = (call: ResolvedEffectCall): boolean =>
  call.module === 'Schema' && call.form === 'data-first'

const boundaryShifts = (call: CallExpression, resolved: ResolvedEffectCall): readonly Expression[] => {
  const name = resolved.exportName
  const swapped = ownEntry(INCLUSIVITY_SWAPS, name)
  const shift = ownEntry(LENGTH_SHIFTS, name)
  return [
    ...Option.toArray(Option.flatMap(swapped, (target) => swappedCheck(resolved, target))),
    ...Option.toArray(Option.flatMap(shift, (operator) => shiftedLength(call, resolved, operator))),
    ...(name === 'isBetween' ? exclusivityToggles(call, resolved) : []),
  ]
}

const ownEntry = <A>(table: Readonly<Record<string, A>>, key: string): Option.Option<A> =>
  Option.flatMap(onlyWhen(Object.hasOwn(table, key), key), (present) => Option.fromNullishOr(table[present]))

const swappedCheck = (resolved: ResolvedEffectCall, swapped: string): Option.Option<Expression> =>
  Option.map(
    resolved.moduleAccess('Schema'),
    (schema) => moduleCall(cloneNode(schema), swapped, resolved.args.map((argument) => cloneNode(argument))),
  )

const shiftedLength = (
  call: CallExpression,
  resolved: ResolvedEffectCall,
  operator: LengthShift,
): Option.Option<Expression> =>
  Option.flatMap(Arr.head(resolved.args), (bound) =>
    Option.map(
      onlyWhen(shiftChangesCardinality(bound, operator), bound),
      (shifted) =>
        callExpression(cloneNode(call.callee), [
          binaryExpression(operator, cloneNode(shifted), numericLiteral(1)),
          ...trailingArguments(resolved),
        ]),
    ))

const shiftChangesCardinality = (bound: Expression, operator: LengthShift): boolean =>
  Option.match(numericValueOf(bound), {
    onNone: () => true,
    onSome: (value) => cardinalityOf(value) !== cardinalityOf(operator === '+' ? value + 1 : value - 1),
  })

const cardinalityOf = (value: number): number => Math.max(0, Math.floor(value))

const numericValueOf = (expression: Expression): Option.Option<number> =>
  isNumericLiteral(expression)
    ? Option.some(expression.value)
    : Option.flatMap(Option.liftPredicate(expression, isNegation), (negation) =>
      Option.map(numericValueOf(negation.argument), (value) => -value))

const exclusivityToggles = (call: CallExpression, resolved: ResolvedEffectCall): readonly Expression[] =>
  Option.match(Option.flatMap(Arr.head(resolved.args), literalOptions), {
    onNone: () => [],
    onSome: (options) =>
      EXCLUSIVITY_FLAGS.flatMap((flag) =>
        Option.toArray(
          Option.map(
            toggledOptions(options, flag),
            (toggled) => callExpression(cloneNode(call.callee), [toggled, ...trailingArguments(resolved)]),
          ),
        )
      ),
  })

const trailingArguments = (resolved: ResolvedEffectCall): readonly Expression[] =>
  resolved.args.slice(1).map((argument) => cloneNode(argument))

const literalOptions = (expression: Expression): Option.Option<ObjectExpression> =>
  Option.filter(
    Option.liftPredicate(expression, isObjectExpression),
    (options) => options.properties.every(isPlainProperty),
  )

const toggledOptions = (options: ObjectExpression, flag: string): Option.Option<ObjectExpression> => {
  const flagged = options.properties.filter(isPlainProperty).filter((property) =>
    Option.exists(keyNameOf(property), (name) => name === flag)
  )
  return Option.orElse(
    Option.map(onlyWhen(flagged.length === 0, options), (unflagged) => withFlagAdded(unflagged, flag)),
    () =>
      Option.flatMap(
        onlyWhen(flagged.length === 1, flagged),
        (single) =>
          Option.flatMap(Arr.head(single), (property) =>
            Option.map(booleanValueOf(property), (value) => withFlagSet(options, property, !value))),
      ),
  )
}

const withFlagAdded = (options: ObjectExpression, flag: string): ObjectExpression => {
  const copy = cloneNode(options)
  return { ...copy, properties: [...copy.properties, objectProperty(identifier(flag), booleanLiteral(true))] }
}

const withFlagSet = (options: ObjectExpression, flagged: ObjectProperty, value: boolean): ObjectExpression => {
  const copy = cloneNode(options)
  const index = options.properties.indexOf(flagged)
  const replacement: ObjectProperty = { ...cloneNode(flagged), value: booleanLiteral(value) }
  return { ...copy, properties: copy.properties.map((property, at) => at === index ? replacement : property) }
}

const booleanValueOf = (property: ObjectProperty): Option.Option<boolean> =>
  Option.map(Option.liftPredicate(property.value, isBooleanLiteral), (literal) => literal.value)

const keyNameOf = (property: ObjectProperty): Option.Option<string> =>
  Option.orElse(
    Option.map(Option.liftPredicate(property.key, isIdentifierKey), (key) => key.name),
    () =>
      Option.flatMap(
        Option.liftPredicate(property.key, isLiteral),
        (literal) => Option.liftPredicate(literal.value, Predicate.isString),
      ),
  )

const isPlainProperty = (property: ObjectExpression['properties'][number]): property is ObjectProperty =>
  property.type === 'Property' && isPlainInit(property)

const isPlainInit = (property: ObjectProperty): boolean =>
  Bool.every([!property.computed, property.kind === 'init', !property.method])

const isObjectExpression = (expression: Expression): expression is ObjectExpression =>
  nodeType(expression) === 'ObjectExpression'

const isIdentifierKey = (key: ObjectProperty['key']): key is IdentifierName => nodeType(key) === 'Identifier'

const isLiteral = (node: Node): node is Literal => nodeType(node) === 'Literal'

const isNumericLiteral = (expression: Node): expression is NumericLiteral =>
  Option.exists(Option.liftPredicate(expression, isLiteral), (literal) => Predicate.isNumber(literal.value))

const isBooleanLiteral = (expression: Node): expression is BooleanLiteral =>
  Option.exists(Option.liftPredicate(expression, isLiteral), (literal) => Predicate.isBoolean(literal.value))

const isUnaryExpression = (expression: Expression): expression is UnaryExpression =>
  nodeType(expression) === 'UnaryExpression'

const isNegation = (expression: Expression): expression is UnaryExpression =>
  Option.exists(Option.liftPredicate(expression, isUnaryExpression), (unary) => unary.operator === '-')

const isCallExpression = (node: Node): node is CallExpression => nodeType(node) === 'CallExpression'
