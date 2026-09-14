import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import { expect } from 'vitest'

import {
  decideWorkflowMakeBoundaryIgnore,
  NOT_INSIDE_WORKFLOW_MAKE,
  strykerIgnorers,
} from '@systemfsoftware/stryker-ignorer-workflow-make-boundary'

import {
  callOf,
  classDeclarationOf,
  constBindingOf,
  identifier,
  makeBodyOf,
  memberOf,
  programOf,
  stringLiteral,
  taggedCall,
  unrelatedImport,
  workflowAliasedImport,
  workflowAndThenCallOf,
  workflowMakeCallOf,
  workflowMakeCallOfTwo,
  workflowNamedImport,
  workflowNamespaceImport,
  workflowTotalCallOf,
} from './__fixtures__/WorkflowMakeAst.fixtures.js'

const Feature = makeFeature({ it, layer })

const makeFixture = (mutant: unknown, ancestors: readonly unknown[]) => ({ mutant, ancestors })

Feature('Workflow.make boundary — the inverted mutation-population selector')
  .body(({ scenario }) => {
    scenario(
      'A mutant inside a Workflow.make body stays live',
      Gherkin.Do.pipe(
        Given('a file whose `Workflow.make(...)` argument body holds the mutant')('fixture', () =>
          Effect.sync(() => {
            const mutant = stringLiteral('decide')
            const body = makeBodyOf(mutant)
            const call = workflowMakeCallOf(body)
            const program = programOf([workflowNamedImport(), call])
            return makeFixture(mutant, [body, call, program])
          })),
        When('the boundary decision runs on the mutant and its ancestor chain')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined — the mutant stays live')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant nested several levels inside a make body stays live',
      Gherkin.Do.pipe(
        Given('a mutant several expression levels below a `Workflow.make(...)` argument')(
          'fixture',
          () =>
            Effect.sync(() => {
              const mutant = identifier('command')
              const callInside = callOf(memberOf('Result', 'succeed'), [mutant])
              const body = makeBodyOf(callInside)
              const call = workflowMakeCallOf(body)
              const program = programOf([workflowNamedImport(), call])
              return makeFixture(mutant, [callInside, body, call, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant at module level outside any make body is ignored',
      Gherkin.Do.pipe(
        Given('a file importing Workflow whose module-level body holds the mutant')('fixture', () =>
          Effect.sync(() => {
            const mutant = stringLiteral('admit')
            const program = programOf([workflowNamedImport(), mutant])
            return makeFixture(mutant, [program])
          })),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns NOT_INSIDE_WORKFLOW_MAKE')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBe(NOT_INSIDE_WORKFLOW_MAKE)
          })
        ),
      ),
    )

    scenario(
      'A mutant in a file that imports no workflow is ignored',
      Gherkin.Do.pipe(
        Given('a file with no effect-cell-types import at all')('fixture', () =>
          Effect.sync(() => {
            const mutant = stringLiteral('plug')
            const program = programOf([unrelatedImport('../local.js', 'Workflow'), mutant])
            return makeFixture(mutant, [program])
          })),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns NOT_INSIDE_WORKFLOW_MAKE')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBe(NOT_INSIDE_WORKFLOW_MAKE)
          })
        ),
      ),
    )

    scenario(
      'A mutant in a make call bound to a local workflow is ignored',
      Gherkin.Do.pipe(
        Given('a `Workflow.make(...)` call whose `Workflow` binding comes from a local module')(
          'fixture',
          () =>
            Effect.sync(() => {
              const mutant = stringLiteral('local')
              const body = makeBodyOf(mutant)
              const call = workflowMakeCallOf(body)
              const program = programOf([unrelatedImport('./local-workflow.js', 'Workflow'), call])
              return makeFixture(mutant, [body, call, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns NOT_INSIDE_WORKFLOW_MAKE — only the cell-types value opens a boundary')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBe(NOT_INSIDE_WORKFLOW_MAKE)
          })
        ),
      ),
    )

    scenario(
      'A mutant in a function referenced by a make call stays live',
      Gherkin.Do.pipe(
        Given('a `Workflow.make(...)` call whose argument names a same-file function holding the mutant')(
          'fixture',
          () =>
            Effect.sync(() => {
              const mutant = stringLiteral('decide')
              const body = makeBodyOf(mutant)
              const decision = constBindingOf('decision', body)
              const call = workflowMakeCallOf(identifier('decision'))
              const program = programOf([workflowNamedImport(), decision, call])
              // The make call is a sibling statement, not an ancestor: the mutant's
              // chain runs mutant -> body -> binding -> program, and the resolution
              // must keep the body inside the population anyway.
              return makeFixture(mutant, [mutant, body, decision, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined — the referenced function body stays inside the mutation population')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant in the decider function of a two-argument make stays live',
      Gherkin.Do.pipe(
        Given(
          'a two-argument `Workflow.make(Command, decide)` whose second argument names the mutant-bearing function',
        )(
          'fixture',
          () =>
            Effect.sync(() => {
              const mutant = stringLiteral('decide')
              const body = makeBodyOf(mutant)
              const decision = constBindingOf('decision', body)
              const command = classDeclarationOf('Cmd')
              const call = workflowMakeCallOfTwo(identifier('Cmd'), identifier('decision'))
              const program = programOf([workflowNamedImport(), command, decision, call])
              // Slot 0 resolves to a class, never a function. A resolver pinned
              // to that slot drops this body from the population and every
              // mutant in the decision silently stops being tested.
              return makeFixture(mutant, [mutant, body, decision, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined — the referenced decider stays inside the mutation population')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant inline in the second argument of a two-argument make stays live',
      Gherkin.Do.pipe(
        Given('a two-argument `Workflow.make(Command, (c) => ...)` holding the mutant inline')(
          'fixture',
          () =>
            Effect.sync(() => {
              const mutant = stringLiteral('inline')
              const body = makeBodyOf(mutant)
              const call = workflowMakeCallOfTwo(identifier('Cmd'), body)
              const program = programOf([workflowNamedImport(), classDeclarationOf('Cmd'), call])
              return makeFixture(mutant, [body, call, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined — an argument-slot ancestor is slot-agnostic')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant naming a missing function is ignored',
      Gherkin.Do.pipe(
        Given('a make call naming an identifier that resolves to no function in the file')(
          'fixture',
          () =>
            Effect.sync(() => {
              const mutant = stringLiteral('admit')
              const call = workflowMakeCallOf(identifier('decideElsewhere'))
              const program = programOf([workflowNamedImport(), call])
              return makeFixture(mutant, [mutant, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns NOT_INSIDE_WORKFLOW_MAKE')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBe(NOT_INSIDE_WORKFLOW_MAKE)
          })
        ),
      ),
    )

    scenario(
      'A mutant in the second of two make calls stays live',
      Gherkin.Do.pipe(
        Given('a file with two `Workflow.make` calls and a mutant inside the second body')(
          'fixture',
          () =>
            Effect.sync(() => {
              const firstBody = makeBodyOf(identifier('first'))
              const mutant = stringLiteral('second')
              const secondBody = makeBodyOf(mutant)
              const secondCall = workflowMakeCallOf(secondBody)
              const program = programOf([workflowNamedImport(), workflowMakeCallOf(firstBody), secondCall])
              return makeFixture(mutant, [secondBody, secondCall, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined — every make boundary holds mutation live')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant inside a nested make stays live',
      Gherkin.Do.pipe(
        Given('a `Workflow.make` call inside another make body, with the mutant in the inner body')(
          'fixture',
          () =>
            Effect.sync(() => {
              const mutant = stringLiteral('inner')
              const innerBody = makeBodyOf(mutant)
              const innerCall = workflowMakeCallOf(innerBody)
              const outerBody = makeBodyOf(innerCall)
              const outerCall = workflowMakeCallOf(outerBody)
              const program = programOf([workflowNamedImport(), outerCall])
              return makeFixture(mutant, [innerBody, innerCall, outerBody, outerCall, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined — the inner make argument is inside a boundary too')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )
    scenario(
      'A mutant inside a make called through a namespace import stays live',
      Gherkin.Do.pipe(
        Given('`import * as Workflow` with the mutant inside the make argument')('fixture', () =>
          Effect.sync(() => {
            const mutant = stringLiteral('namespace')
            const body = makeBodyOf(mutant)
            const call = workflowMakeCallOf(body)
            const program = programOf([workflowNamespaceImport('Workflow'), call])
            return makeFixture(mutant, [body, call, program])
          })),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant inside a make called through an aliased import stays live',
      Gherkin.Do.pipe(
        Given('`import { Workflow as W }` with the mutant inside `W.make(...)`')('fixture', () =>
          Effect.sync(() => {
            const mutant = stringLiteral('aliased')
            const body = makeBodyOf(mutant)
            const call = workflowMakeCallOf(body, 'W')
            const program = programOf([workflowAliasedImport('W'), call])
            return makeFixture(mutant, [body, call, program])
          })),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant inside a Workflow.total body stays live like the make-body equivalent',
      Gherkin.Do.pipe(
        Given('a `Workflow.total(...)` decider body holding the mutant')('fixture', () =>
          Effect.sync(() => {
            const mutant = stringLiteral('total')
            const body = makeBodyOf(mutant)
            const call = workflowTotalCallOf(body)
            const program = programOf([workflowNamedImport(), call])
            return makeFixture(mutant, [body, call, program])
          })),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined — a total body is a decider body exactly as a make body is')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant inside a total called through a namespace import stays live',
      Gherkin.Do.pipe(
        Given('`import * as Workflow` with the mutant inside the total argument')('fixture', () =>
          Effect.sync(() => {
            const mutant = stringLiteral('namespace')
            const body = makeBodyOf(mutant)
            const call = workflowTotalCallOf(body)
            const program = programOf([workflowNamespaceImport('Workflow'), call])
            return makeFixture(mutant, [body, call, program])
          })),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A mutant inside a total called through an aliased import stays live',
      Gherkin.Do.pipe(
        Given('`import { Workflow as W }` with the mutant inside `W.total(...)`')('fixture', () =>
          Effect.sync(() => {
            const mutant = stringLiteral('aliased')
            const body = makeBodyOf(mutant)
            const call = workflowTotalCallOf(body, 'W')
            const program = programOf([workflowAliasedImport('W'), call])
            return makeFixture(mutant, [body, call, program])
          })),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns undefined')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBeUndefined()
          })
        ),
      ),
    )

    scenario(
      'A decider-shaped andThen argument contributes no mutation population',
      Gherkin.Do.pipe(
        Given('the same decider-shaped argument under `Workflow.make` and under `Workflow.andThen`')(
          'fixtures',
          () =>
            Effect.sync(() => {
              const mutant = stringLiteral('step')
              const body = makeBodyOf(mutant)
              const makeCall = workflowMakeCallOf(body)
              const andThenCall = workflowAndThenCallOf([identifier('first'), body])
              const program = programOf([workflowNamedImport(), makeCall, andThenCall])
              return {
                mutant,
                makeAncestors: [body, makeCall, program],
                andThenAncestors: [body, andThenCall, program],
              }
            }),
        ),
        When('the boundary decision runs on the mutant against each ancestor chain')(
          'verdicts',
          (s) =>
            Effect.sync(() => ({
              make: decideWorkflowMakeBoundaryIgnore(s.fixtures.mutant, s.fixtures.makeAncestors),
              andThen: decideWorkflowMakeBoundaryIgnore(s.fixtures.mutant, s.fixtures.andThenAncestors),
            })),
        ),
        Then('the make boundary holds the mutant live and the composing boundary is not a decider body')((s) =>
          Effect.sync(() => {
            expect(s.verdicts.make).toBeUndefined()
            expect(s.verdicts.andThen).toBe(NOT_INSIDE_WORKFLOW_MAKE)
          })
        ),
      ),
    )

    scenario(
      'A composing andThen operand that resolves to a same-file function joins no population',
      Gherkin.Do.pipe(
        Given('a `Workflow.andThen(...)` operand naming a same-file function holding the mutant')(
          'fixture',
          () =>
            Effect.sync(() => {
              const mutant = stringLiteral('compose')
              const operandBody = makeBodyOf(mutant)
              const operand = constBindingOf('upstreamStep', operandBody)
              const andThenCall = workflowAndThenCallOf([identifier('upstreamStep'), identifier('second')])
              const program = programOf([workflowNamedImport(), operand, andThenCall])
              return makeFixture(mutant, [mutant, operandBody, operand, program])
            }),
        ),
        When('the boundary decision runs on that mutant')(
          'reason',
          (s) => Effect.sync(() => decideWorkflowMakeBoundaryIgnore(s.fixture.mutant, s.fixture.ancestors)),
        ),
        Then('it returns NOT_INSIDE_WORKFLOW_MAKE')((s) =>
          Effect.sync(() => {
            expect(s.reason).toBe(NOT_INSIDE_WORKFLOW_MAKE)
          })
        ),
      ),
    )

    scenario(
      'The exported descriptor registers under the workflow-make-boundary name and answers like the decision function',
      Gherkin.Do.pipe(
        Given('a schema tag outside every make body, and the package descriptor')('node', () =>
          Effect.sync(() => {
            const tag = stringLiteral('Placed')
            const fields = { type: 'ObjectExpression' as const }
            const call = taggedCall('TaggedClass', tag, fields)
            const program = programOf([workflowNamedImport(), call])
            const path = { node: tag, parentPath: { node: call, parentPath: { node: program, parentPath: null } } }
            return { tag, call, program, path, descriptor: strykerIgnorers[0] }
          })),
        When('the descriptor and the decision function each examine it')('answers', (s) =>
          Effect.sync(() => ({
            name: s.node.descriptor?.name,
            descriptor: s.node.descriptor?.shouldIgnore(s.node.path),
            decision: decideWorkflowMakeBoundaryIgnore(s.node.tag, [s.node.call, s.node.program]),
          }))),
        Then('the descriptor carries the registered name and both answer with NOT_INSIDE_WORKFLOW_MAKE')((s) =>
          Effect.sync(() => {
            expect(s.answers.name).toBe('workflow-make-boundary')
            expect(s.answers.descriptor).toBe(NOT_INSIDE_WORKFLOW_MAKE)
            expect(s.answers.descriptor).toBe(s.answers.decision)
          })
        ),
      ),
    )
  })
