import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { NodeModulesSearchCommand, planNodeModulesLinks } from '../plan-node-modules-links.workflow.js'

describe('planNodeModulesLinks', () => {
  it.prop(
    '∀c_PlanNodeModulesLinks_⊨LinksEveryFoundNodeModulesInOrder',
    { of: [NodeModulesSearchCommand], subject: planNodeModulesLinks },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          Match.value(decision).pipe(
            Match.tag('NodeModulesNotFound', () => command.found.length === 0),
            Match.tag('NodeModulesLinked', ({ nodeModules }) =>
              nodeModules.length === command.found.length &&
              nodeModules.every((found, index) => found === command.found[index])),
            Match.exhaustive,
          ),
      }),
  )
})
