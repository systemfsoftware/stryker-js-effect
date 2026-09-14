import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { ancestorsOf, type NodePath } from '@systemfsoftware/stryker-ignorer'

const Feature = makeFeature({ it, layer })

Feature("Tracing a mutant's enclosing nodes from nearest to root")
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'A mutant whose enclosing node carries host-only extras still reports that node',
      Gherkin.Do.pipe(
        Given('a path whose parent carries a predicate the host added')('path', () =>
          Effect.sync(() => {
            const parent = { node: 'the enclosing node', parentPath: null, isObjectExpression: () => false }
            const path: NodePath = { node: 'the mutant', parentPath: parent }
            return path
          })),
        When('the mutant asks for its ancestry')('ancestry', (s) => Effect.sync(() => [...ancestorsOf(s.path)])),
        Then('the enclosing node is reported')((s) =>
          Effect.sync(() => {
            expect(s.ancestry).toStrictEqual(['the enclosing node'])
          })
        ),
      ),
    )

    scenarioOutline(
      'A mutant stated as <parentless> reports no ancestry',
      [
        { parentless: 'an only node with no parent stated' },
        { parentless: 'an only node whose parent is explicitly nothing' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a path holding ${row.parentless}`)('path', () =>
            Effect.sync(() =>
              row.parentless.includes('explicitly') ? { node: 'the mutant', parentPath: null } : { node: 'the mutant' }
            )),
          When('the mutant asks for its ancestry')('ancestry', (s) =>
            Effect.sync(() => [...ancestorsOf(s.path)])),
          Then('nothing is reported')((s) =>
            Effect.sync(() => {
              expect(s.ancestry).toStrictEqual([])
            })
          ),
        ),
    )
  })
