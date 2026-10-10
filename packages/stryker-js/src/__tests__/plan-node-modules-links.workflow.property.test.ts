import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  NodeModulesLinked,
  NodeModulesSearchCommand,
  planNodeModulesLinks,
} from '../plan-node-modules-links.workflow.js'

describe('planNodeModulesLinks', () => {
  it.prop(
    '∀c_PlanNodeModulesLinks_⊨LinksEveryFoundNodeModulesInOrderOnlyWhenLinking',
    { of: [NodeModulesSearchCommand], subject: planNodeModulesLinks },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          Match.value(decision).pipe(
            Match.tag('NodeModulesNotLinked', () => !command.linking),
            Match.tag('NodeModulesNotFound', () => command.linking && command.found.length === 0),
            Match.tag('NodeModulesLinked', ({ nodeModules }) =>
              command.linking &&
              nodeModules.length === command.found.length &&
              nodeModules.every((found, index) => found === command.found[index])),
            Match.exhaustive,
          ),
      }),
  )

  it.prop(
    '∀n_NodeModulesLinkedRefusal_≡EmptyList',
    { of: [S.Array(S.String)], subject: S.decodeUnknownResult(NodeModulesLinked) },
    (subject, [nodeModules]) =>
      Result.isSuccess(subject({ _tag: 'NodeModulesLinked', nodeModules })) ===
        Arr.isReadonlyArrayNonEmpty(nodeModules),
  )
})
