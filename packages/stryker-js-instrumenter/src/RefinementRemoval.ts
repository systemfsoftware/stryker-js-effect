import type { CallExpression, Expression, MemberExpression, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import { arrowFunctionExpression, callExpression, cloneNode, identifier, nodeType } from './Ast.handle.js'
import { freshIdentifier, identifiersIn, onlyWhen, type ResolvedEffectCall, resolveEffectCall } from './EffectCall.js'
import type { MutatorContext } from './Mutator.service.js'

const refinementRemovalMutatorDataFirst = (node: Node, context: MutatorContext): readonly Node[] =>
  Option.getOrElse(
    Option.flatMap(Option.liftPredicate(node, isCallExpression), (call) =>
      Option.map(Option.filter(resolveEffectCall(call, context), isSchemaCheck), (resolved) =>
        removals(call, resolved))),
    (): readonly Node[] => [],
  )

export const refinementRemovalMutator: {
  (node: Node, context: MutatorContext): readonly Node[]
  (context: MutatorContext): (node: Node) => readonly Node[]
} = dual((args: IArguments): boolean => args.length >= 2, refinementRemovalMutatorDataFirst)

const isSchemaCheck = (call: ResolvedEffectCall): boolean => call.module === 'Schema' && call.exportName === 'check'

const removals = (call: CallExpression, resolved: ResolvedEffectCall): readonly Expression[] =>
  resolved.args.length >= 2
    ? resolved.args.map((_, dropped) =>
      callExpression(
        cloneNode(call.callee),
        resolved.args.filter((__, index) => index !== dropped).map((argument) => cloneNode(argument)),
      )
    )
    : Option.toArray(wholeCallRemoval(call, resolved))

const wholeCallRemoval = (call: CallExpression, resolved: ResolvedEffectCall): Option.Option<Expression> =>
  Option.flatMap(onlyWhen(resolved.args.length === 1, resolved), (single) =>
    single.form === 'receiver-method'
      ? Option.map(receiverOf(call), (receiver) => cloneNode(receiver))
      : Option.some(identityOf(single)))

const identityOf = (call: ResolvedEffectCall): Expression => {
  const name = freshIdentifier('self', new Set(call.args.flatMap((argument) => identifiersIn(argument))))
  return arrowFunctionExpression([identifier(name)], identifier(name))
}

const receiverOf = (call: CallExpression): Option.Option<Expression> =>
  Option.map(Option.liftPredicate(call.callee, isMemberExpression), (member) => member.object)

const isMemberExpression = (callee: CallExpression['callee']): callee is MemberExpression =>
  nodeType(callee) === 'MemberExpression'

const isCallExpression = (node: Node): node is CallExpression => nodeType(node) === 'CallExpression'
