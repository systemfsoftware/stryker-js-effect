import { describe, expect, it } from 'vitest'

import type { PlainIgnorer } from '@systemfsoftware/stryker-ignorer-interface'
import {
  type IgnorerPathSpec,
  IgnoreTester,
  type IgnoreTesterCases,
} from '@systemfsoftware/stryker-ignorer-interface/testing'

import { NOT_INSIDE_WORKFLOW_MAKE, strykerIgnorers } from '../src/mod.js'
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

const DESCRIPTOR_NAME = 'workflow-make-boundary'

const descriptorOf = (ignorer: PlainIgnorer | undefined): PlainIgnorer => {
  if (ignorer === undefined) {
    throw new Error(`@systemfsoftware/stryker-ignorer-workflow-make-boundary exports no ${DESCRIPTOR_NAME} descriptor`)
  }
  return ignorer
}

const spec = (node: unknown, ancestors: readonly unknown[]): IgnorerPathSpec => ({ node, ancestors })

const argumentBody = (
  value: string,
  workflowCall: (body: unknown) => unknown,
  workflowImport: () => unknown,
): IgnorerPathSpec => {
  const mutant = stringLiteral(value)
  const body = makeBodyOf(mutant)
  const call = workflowCall(body)
  const program = programOf([workflowImport(), call])
  return spec(mutant, [body, call, program])
}

const insideMakeBody = (): IgnorerPathSpec => argumentBody('decide', workflowMakeCallOf, workflowNamedImport)

const nestedInsideMakeBody = (): IgnorerPathSpec => {
  const mutant = identifier('command')
  const callInside = callOf(memberOf('Result', 'succeed'), [mutant])
  const body = makeBodyOf(callInside)
  const call = workflowMakeCallOf(body)
  const program = programOf([workflowNamedImport(), call])
  return spec(mutant, [callInside, body, call, program])
}

const moduleLevel = (): IgnorerPathSpec => {
  const mutant = stringLiteral('admit')
  const program = programOf([workflowNamedImport(), mutant])
  return spec(mutant, [program])
}

const noWorkflowImport = (): IgnorerPathSpec => {
  const mutant = stringLiteral('plug')
  const program = programOf([unrelatedImport('../local.js', 'Workflow'), mutant])
  return spec(mutant, [program])
}

const localWorkflowBinding = (): IgnorerPathSpec =>
  argumentBody('local', workflowMakeCallOf, () => unrelatedImport('./local-workflow.js', 'Workflow'))

const referencedFunction = (): IgnorerPathSpec => {
  const mutant = stringLiteral('decide')
  const body = makeBodyOf(mutant)
  const decision = constBindingOf('decision', body)
  const call = workflowMakeCallOf(identifier('decision'))
  const program = programOf([workflowNamedImport(), decision, call])
  return spec(mutant, [mutant, body, decision, program])
}

const twoArgumentDecider = (): IgnorerPathSpec => {
  const mutant = stringLiteral('decide')
  const body = makeBodyOf(mutant)
  const decision = constBindingOf('decision', body)
  const command = classDeclarationOf('Cmd')
  const call = workflowMakeCallOfTwo(identifier('Cmd'), identifier('decision'))
  const program = programOf([workflowNamedImport(), command, decision, call])
  return spec(mutant, [mutant, body, decision, program])
}

const twoArgumentInline = (): IgnorerPathSpec => {
  const mutant = stringLiteral('inline')
  const body = makeBodyOf(mutant)
  const call = workflowMakeCallOfTwo(identifier('Cmd'), body)
  const program = programOf([workflowNamedImport(), classDeclarationOf('Cmd'), call])
  return spec(mutant, [body, call, program])
}

const missingFunction = (): IgnorerPathSpec => {
  const mutant = stringLiteral('admit')
  const call = workflowMakeCallOf(identifier('decideElsewhere'))
  const program = programOf([workflowNamedImport(), call])
  return spec(mutant, [mutant, program])
}

const secondMakeCall = (): IgnorerPathSpec => {
  const firstBody = makeBodyOf(identifier('first'))
  const mutant = stringLiteral('second')
  const secondBody = makeBodyOf(mutant)
  const secondCall = workflowMakeCallOf(secondBody)
  const program = programOf([workflowNamedImport(), workflowMakeCallOf(firstBody), secondCall])
  return spec(mutant, [secondBody, secondCall, program])
}

const nestedMake = (): IgnorerPathSpec => {
  const mutant = stringLiteral('inner')
  const innerBody = makeBodyOf(mutant)
  const innerCall = workflowMakeCallOf(innerBody)
  const outerBody = makeBodyOf(innerCall)
  const outerCall = workflowMakeCallOf(outerBody)
  const program = programOf([workflowNamedImport(), outerCall])
  return spec(mutant, [innerBody, innerCall, outerBody, outerCall, program])
}

const namespaceMake = (): IgnorerPathSpec =>
  argumentBody('namespace', workflowMakeCallOf, () => workflowNamespaceImport('Workflow'))

const aliasedMake = (): IgnorerPathSpec =>
  argumentBody('aliased', (body) => workflowMakeCallOf(body, 'W'), () => workflowAliasedImport('W'))

const totalBody = (): IgnorerPathSpec => argumentBody('total', workflowTotalCallOf, workflowNamedImport)

const namespaceTotal = (): IgnorerPathSpec =>
  argumentBody('namespace', workflowTotalCallOf, () => workflowNamespaceImport('Workflow'))

const aliasedTotal = (): IgnorerPathSpec =>
  argumentBody('aliased', (body) => workflowTotalCallOf(body, 'W'), () => workflowAliasedImport('W'))

const andThenArgument = (): { readonly make: IgnorerPathSpec; readonly andThen: IgnorerPathSpec } => {
  const mutant = stringLiteral('step')
  const body = makeBodyOf(mutant)
  const makeCall = workflowMakeCallOf(body)
  const andThenCall = workflowAndThenCallOf([identifier('first'), body])
  const program = programOf([workflowNamedImport(), makeCall, andThenCall])
  return { make: spec(mutant, [body, makeCall, program]), andThen: spec(mutant, [body, andThenCall, program]) }
}

const composingAndThenOperand = (): IgnorerPathSpec => {
  const mutant = stringLiteral('compose')
  const operandBody = makeBodyOf(mutant)
  const operand = constBindingOf('upstreamStep', operandBody)
  const andThenCall = workflowAndThenCallOf([identifier('upstreamStep'), identifier('second')])
  const program = programOf([workflowNamedImport(), operand, andThenCall])
  return spec(mutant, [mutant, operandBody, operand, program])
}

const descriptorTag = (): IgnorerPathSpec => {
  const tag = stringLiteral('Placed')
  const fields = { type: 'ObjectExpression' as const }
  const call = taggedCall('TaggedClass', tag, fields)
  const program = programOf([workflowNamedImport(), call])
  return spec(tag, [call, program])
}

const AND_THEN_ARGUMENT = andThenArgument()

const CASES: IgnoreTesterCases = {
  ignored: [
    {
      name: 'A mutant at module level outside any make body is ignored',
      path: moduleLevel(),
      reason: NOT_INSIDE_WORKFLOW_MAKE,
    },
    {
      name: 'A mutant in a file that imports no workflow is ignored',
      path: noWorkflowImport(),
      reason: NOT_INSIDE_WORKFLOW_MAKE,
    },
    {
      name: 'A mutant in a make call bound to a local workflow is ignored',
      path: localWorkflowBinding(),
      reason: NOT_INSIDE_WORKFLOW_MAKE,
    },
    {
      name: 'A mutant naming a missing function is ignored',
      path: missingFunction(),
      reason: NOT_INSIDE_WORKFLOW_MAKE,
    },
    {
      name: 'A decider-shaped andThen argument contributes no mutation population',
      path: AND_THEN_ARGUMENT.andThen,
      reason: NOT_INSIDE_WORKFLOW_MAKE,
    },
    {
      name: 'A composing andThen operand that resolves to a same-file function joins no population',
      path: composingAndThenOperand(),
      reason: NOT_INSIDE_WORKFLOW_MAKE,
    },
    {
      name:
        'The exported descriptor registers under the workflow-make-boundary name and answers like the decision function',
      path: descriptorTag(),
      reason: NOT_INSIDE_WORKFLOW_MAKE,
    },
  ],
  kept: [
    { name: 'A mutant inside a Workflow.make body stays live', path: insideMakeBody() },
    { name: 'A mutant nested several levels inside a make body stays live', path: nestedInsideMakeBody() },
    { name: 'A mutant in a function referenced by a make call stays live', path: referencedFunction() },
    { name: 'A mutant in the decider function of a two-argument make stays live', path: twoArgumentDecider() },
    { name: 'A mutant inline in the second argument of a two-argument make stays live', path: twoArgumentInline() },
    { name: 'A mutant in the second of two make calls stays live', path: secondMakeCall() },
    { name: 'A mutant inside a nested make stays live', path: nestedMake() },
    {
      name: 'A mutant inside a make called through a namespace import stays live',
      path: namespaceMake(),
    },
    { name: 'A mutant inside a make called through an aliased import stays live', path: aliasedMake() },
    {
      name: 'A mutant inside a Workflow.total body stays live like the make-body equivalent',
      path: totalBody(),
    },
    { name: 'A mutant inside a total called through a namespace import stays live', path: namespaceTotal() },
    { name: 'A mutant inside a total called through an aliased import stays live', path: aliasedTotal() },
    {
      name: 'A make-position mutant beside a decider-shaped andThen argument stays live',
      path: AND_THEN_ARGUMENT.make,
    },
  ],
}

IgnoreTester.describe = describe
IgnoreTester.it = it
IgnoreTester.expect = expect

IgnoreTester.run(DESCRIPTOR_NAME, descriptorOf(strykerIgnorers[0]), CASES)
