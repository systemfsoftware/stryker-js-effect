import type { Expression, Node } from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import { cloneNode } from './Ast.handle.js'
import { moduleCall, onlyWhen, type ResolvedEffectCall, resolveEffectCall } from './EffectCall.js'
import type { MutatorContext } from './Mutator.service.js'

const failureToDefectMutatorDataFirst = (node: Node, context: MutatorContext): readonly Node[] =>
  Option.toArray(Option.flatMap(resolveEffectCall(node, context), defectOf))

export const failureToDefectMutator: {
  (node: Node, context: MutatorContext): readonly Node[]
  (context: MutatorContext): (node: Node) => readonly Node[]
} = dual((args: IArguments): boolean => args.length >= 2, failureToDefectMutatorDataFirst)

const defectOf = (call: ResolvedEffectCall): Option.Option<Expression> =>
  Option.flatMap(
    onlyWhen(call.module === 'Effect' && call.exportName === 'fail', call),
    (failure) =>
      Option.flatMap(failure.moduleAccess('Effect'), (effectModule) =>
        Option.map(Arr.get(failure.args, 0), (error) =>
          moduleCall(effectModule, 'die', [cloneNode(error)]))),
  )
