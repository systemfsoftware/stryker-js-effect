import type {
  ArrowFunctionExpression,
  Expression,
  FunctionExpression,
  Node,
  ParamPattern,
} from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import {
  arrowFunctionExpression,
  binaryExpression,
  callExpression,
  cloneNode,
  conditionalExpression,
  identifier,
  logicalExpression,
  memberExpression,
  nodeType,
  stringLiteral,
  unaryExpression,
} from './Ast.handle.js'
import {
  freshIdentifier,
  identifiersIn,
  isDroppableArgument,
  isMovableArgument,
  moduleCall,
  onlyWhen,
  type ResolvedEffectCall,
  resolveEffectCall,
} from './EffectCall.handle.js'
import type { Mutator } from './Mutator.service.js'

const NO_MUTANTS: readonly Node[] = []

const COVERED_MODULE = 'Effect'

const TAG = '_tag'
const SUCCESS_TAG = 'Success'
const INTERRUPT_TAG = 'Interrupt'

const finalizerEscapeMutatorDataFirst: Mutator = (node, context) =>
  Option.match(resolveEffectCall(node, context), {
    onNone: () => NO_MUTANTS,
    onSome: (call) => Option.toArray(replacementOf(call)),
  })

export const finalizerEscapeMutator: {
  (node: Parameters<Mutator>[0], context: Parameters<Mutator>[1]): ReturnType<Mutator>
  (context: Parameters<Mutator>[1]): (node: Parameters<Mutator>[0]) => ReturnType<Mutator>
} = dual((args: IArguments): boolean => args.length >= 2, finalizerEscapeMutatorDataFirst)

type CoveredForm = 'data-first' | 'data-last'

type EscapeShape =
  | { readonly kind: 'ensuring'; readonly fin: Expression }
  | { readonly kind: 'onExit'; readonly f: Expression }
  | { readonly kind: 'onError'; readonly h: Expression }
  | { readonly kind: 'onInterrupt'; readonly h: Expression }
  | { readonly kind: 'acquireRelease'; readonly rel: Expression }
  | {
    readonly kind: 'acquireUseRelease'
    readonly use: Expression
    readonly rel: Expression
    readonly releaseArity: number
  }

interface EscapeBinders {
  readonly self: string
  readonly exit: string
  readonly cause: string
  readonly reason: string
  readonly a: string
}

interface EscapePlan {
  readonly effect: Expression
  readonly self: Expression
  readonly shape: EscapeShape
  readonly binders: EscapeBinders
}

interface SplitArguments {
  readonly self: Option.Option<Expression>
  readonly rest: readonly Expression[]
}

const replacementOf = (call: ResolvedEffectCall): Option.Option<Expression> =>
  Option.flatMap(
    onlyWhen(call.module === COVERED_MODULE, call),
    (covered) =>
      Option.flatMap(covered.moduleAccess(COVERED_MODULE), (effect) =>
        Option.flatMap(coveredForm(covered), (form) =>
          Option.flatMap(splitArguments(covered, form), (split) =>
            Option.flatMap(shapeOf(covered.exportName, split.rest), (shape) =>
              Option.some(replacementExpression(call, effect, form, split, shape)))))),
  )

const replacementExpression = (
  call: ResolvedEffectCall,
  effect: Expression,
  form: CoveredForm,
  split: SplitArguments,
  shape: EscapeShape,
): Expression => {
  const binders = freshBinders(takenNames(call, effect))
  const plan: EscapePlan = { effect, self: selfExpression(split, binders), shape, binders }
  return placedBody(form, bodyExpression(plan), binders)
}

const coveredForm = (call: ResolvedEffectCall): Option.Option<CoveredForm> =>
  Match.value(call.form).pipe(
    Match.when('data-first', () => Option.some<CoveredForm>('data-first')),
    Match.when('data-last-pipe-arg', () => Option.some<CoveredForm>('data-last')),
    Match.when('data-last-pipe-method', () => Option.some<CoveredForm>('data-last')),
    Match.when('data-last-immediate', () => Option.some<CoveredForm>('data-last')),
    Match.orElse(() => Option.none<CoveredForm>()),
  )

const splitArguments = (call: ResolvedEffectCall, form: CoveredForm): Option.Option<SplitArguments> =>
  Match.value(form).pipe(
    Match.when('data-first', () => dataFirstArguments(call)),
    Match.orElse(() => Option.some({ self: Option.none(), rest: [...call.args] })),
  )

const dataFirstArguments = (call: ResolvedEffectCall): Option.Option<SplitArguments> =>
  Option.map(Arr.get(call.args, 0), (self) => ({ self: Option.some(cloneNode(self)), rest: call.args.slice(1) }))

const selfExpression = (split: SplitArguments, binders: EscapeBinders): Expression =>
  Option.getOrElse(split.self, () => identifier(binders.self))

const shapeOf = (exportName: string, rest: readonly Expression[]): Option.Option<EscapeShape> =>
  Match.value(exportName).pipe(
    Match.when('ensuring', () => finalizerShape(rest)),
    Match.when('onExit', () => exitShape(rest)),
    Match.when('onError', () => handlerShape(rest)),
    Match.when('onInterrupt', () => droppedHandlerShape(rest)),
    Match.when('acquireRelease', () => releaseShape(rest)),
    Match.when('acquireUseRelease', () => useReleaseShape(rest)),
    Match.orElse(() => Option.none<EscapeShape>()),
  )

const finalizerShape = (rest: readonly Expression[]): Option.Option<EscapeShape> =>
  Option.flatMap(Arr.get(rest, 0), (fin) => onlyWhen<EscapeShape>(isMovableArgument(fin), { kind: 'ensuring', fin }))

const exitShape = (rest: readonly Expression[]): Option.Option<EscapeShape> =>
  Option.map(Arr.get(rest, 0), (f): EscapeShape => ({ kind: 'onExit', f }))

const handlerShape = (rest: readonly Expression[]): Option.Option<EscapeShape> =>
  Option.map(Arr.get(rest, 0), (h): EscapeShape => ({ kind: 'onError', h }))

const droppedHandlerShape = (rest: readonly Expression[]): Option.Option<EscapeShape> =>
  Option.flatMap(Arr.get(rest, 0), (h) => onlyWhen<EscapeShape>(isDroppableArgument(h), { kind: 'onInterrupt', h }))

const releaseShape = (rest: readonly Expression[]): Option.Option<EscapeShape> =>
  Option.flatMap(
    Arr.get(rest, 0),
    (rel) =>
      Option.flatMap(droppableOptionAt(rest, 1), (optionsDroppable) =>
        onlyWhen<EscapeShape>(Bool.and(isMovableArgument(rel), optionsDroppable), { kind: 'acquireRelease', rel })),
  )

const useReleaseShape = (rest: readonly Expression[]): Option.Option<EscapeShape> =>
  Option.flatMap(
    Arr.get(rest, 1),
    (rel) =>
      Option.flatMap(Arr.get(rest, 0), (use) =>
        Option.flatMap(releaseArityOf(rel), (releaseArity) =>
          onlyWhen<EscapeShape>(isMovableArgument(rel), {
            kind: 'acquireUseRelease',
            use,
            rel,
            releaseArity,
          }))),
  )

const droppableOptionAt = (rest: readonly Expression[], index: number): Option.Option<boolean> =>
  Option.match(Arr.get(rest, index), {
    onNone: () => Option.some(true),
    onSome: (argument) => onlyWhen(isDroppableArgument(argument), true),
  })

const bodyExpression = (plan: EscapePlan): Expression =>
  Match.value(plan.shape).pipe(
    Match.when({ kind: 'ensuring' }, (shape) =>
      moduleCall(plan.effect, 'onExitIf', [
        plan.self,
        notInterruptedPredicate(plan.binders),
        arrowFunctionExpression([], shape.fin),
      ])),
    Match.when({ kind: 'onExit' }, (shape) =>
      moduleCall(plan.effect, 'onExitIf', [plan.self, notInterruptedPredicate(plan.binders), shape.f])),
    Match.when({ kind: 'onError' }, (shape) =>
      moduleCall(plan.effect, 'onErrorIf', [plan.self, noInterruptPredicate(plan.binders), shape.h])),
    Match.when({ kind: 'onInterrupt' }, () =>
      plan.self),
    Match.when({ kind: 'acquireRelease' }, (shape) =>
      releaseBody(plan, shape)),
    Match.when({ kind: 'acquireUseRelease' }, (shape) =>
      useReleaseBody(plan, shape)),
    Match.exhaustive,
  )

const releaseBody = (plan: EscapePlan, shape: Extract<EscapeShape, { readonly kind: 'acquireRelease' }>): Expression =>
  moduleCall(plan.effect, 'flatMap', [
    moduleCall(plan.effect, 'interruptible', [plan.self]),
    arrowFunctionExpression(
      [identifier(plan.binders.a)],
      moduleCall(plan.effect, 'acquireRelease', [
        moduleCall(plan.effect, 'succeed', [identifier(plan.binders.a)]),
        shape.rel,
      ]),
    ),
  ])

const useReleaseBody = (
  plan: EscapePlan,
  shape: Extract<EscapeShape, { readonly kind: 'acquireUseRelease' }>,
): Expression =>
  moduleCall(plan.effect, 'acquireUseRelease', [
    plan.self,
    shape.use,
    arrowFunctionExpression(
      [identifier(plan.binders.a), identifier(plan.binders.exit)],
      conditionalExpression(
        notInterruptedTest(plan.binders),
        appliedRelease(shape.rel, plan.binders, shape.releaseArity),
        memberExpression(plan.effect, identifier('void'), false),
      ),
    ),
  ])

const appliedRelease = (rel: Expression, binders: EscapeBinders, releaseArity: number): Expression =>
  callExpression(rel, Arr.take([identifier(binders.a), identifier(binders.exit)], releaseArity))

type InlineFunction = ArrowFunctionExpression | FunctionExpression

const releaseArityOf = (rel: Expression): Option.Option<number> =>
  Match.value(rel).pipe(
    Match.when(isInlineFunction, plainParameterArity),
    Match.orElse(() => Option.none<number>()),
  )

const isInlineFunction = (candidate: Node): candidate is InlineFunction =>
  nodeType(candidate) === 'ArrowFunctionExpression' || nodeType(candidate) === 'FunctionExpression'

const plainParameterArity = (fn: InlineFunction): Option.Option<number> =>
  onlyWhen(
    Bool.and(fn.params.every(isPlainParameter), fn.params.length <= 2),
    fn.params.length,
  )

const isPlainParameter = (param: ParamPattern): boolean => nodeType(param) === 'Identifier'

const placedBody = (form: CoveredForm, body: Expression, binders: EscapeBinders): Expression =>
  Match.value(form).pipe(
    Match.when('data-first', () => body),
    Match.orElse(() => arrowFunctionExpression([identifier(binders.self)], body)),
  )

const notInterruptedPredicate = (binders: EscapeBinders): Expression =>
  arrowFunctionExpression([identifier(binders.exit)], notInterruptedTest(binders))

const notInterruptedTest = (binders: EscapeBinders): Expression =>
  logicalExpression(
    '||',
    tagCheck(binders.exit, SUCCESS_TAG),
    unaryExpression('!', interruptionSome(failureReasons(binders.exit), binders.reason)),
  )

const noInterruptPredicate = (binders: EscapeBinders): Expression =>
  arrowFunctionExpression(
    [identifier(binders.cause)],
    unaryExpression('!', interruptionSome(causeReasons(binders.cause), binders.reason)),
  )

const tagCheck = (name: string, tag: string): Expression =>
  binaryExpression('===', memberExpression(identifier(name), identifier(TAG), false), stringLiteral(tag))

const failureReasons = (exitName: string): Expression =>
  memberExpression(memberExpression(identifier(exitName), identifier('cause'), false), identifier('reasons'), false)

const causeReasons = (causeName: string): Expression =>
  memberExpression(identifier(causeName), identifier('reasons'), false)

const interruptionSome = (reasons: Expression, reasonName: string): Expression =>
  callExpression(memberExpression(reasons, identifier('some'), false), [
    arrowFunctionExpression([identifier(reasonName)], tagCheck(reasonName, INTERRUPT_TAG)),
  ])

const takenNames = (call: ResolvedEffectCall, effect: Expression): ReadonlySet<string> =>
  new Set([
    ...call.args.flatMap((argument) => identifiersIn(argument)),
    ...identifiersIn(effect),
  ])

const freshBinders = (taken: ReadonlySet<string>): EscapeBinders => ({
  self: freshIdentifier('self', taken),
  exit: freshIdentifier('exit', taken),
  cause: freshIdentifier('cause', taken),
  reason: freshIdentifier('reason', taken),
  a: freshIdentifier('a', taken),
})
