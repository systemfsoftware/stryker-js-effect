import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type LinkSpec, LISTED_LINKS, ListedLink } from '../../tests/__fixtures__/classify-context-link-law.fixture.js'
import { classifyContextLink, ClassifyContextLinkCommand, ContextSlot } from '../classify-context-link.workflow.js'

const outcomeOf = (command: ClassifyContextLinkCommand): string =>
  Result.match(classifyContextLink(command), {
    onFailure: () => 'refused',
    onSuccess: (link) =>
      Match.valueTags(link, {
        LinkClimb: () => 'climb',
        LinkClimbFunction: () => 'climb-function',
        LinkDeclared: () => 'declared',
        LinkCallArgument: () => 'call-argument',
        LinkUnenforced: () => 'unenforced',
      }),
  })

const permittedOf = (command: ClassifyContextLinkCommand): ReadonlyArray<string> =>
  Option.match(
    Arr.findFirst(
      Object.values(LISTED_LINKS),
      (spec) => spec.kind === command.parentKind && spec.slot === command.slot,
    ),
    { onNone: () => ['unenforced'], onSome: (spec) => spec.outcomes },
  )

const onLink = (spec: LinkSpec, facts: ClassifyContextLinkCommand): Option.Option<ClassifyContextLinkCommand> =>
  Option.map(S.decodeUnknownOption(ContextSlot)(spec.slot), (slot) =>
    ClassifyContextLinkCommand.make({
      parentKind: spec.kind,
      slot,
      operator: facts.operator,
      constAssertion: facts.constAssertion,
      annotated: facts.annotated,
      returnTarget: facts.returnTarget,
      leftOperand: facts.leftOperand,
    }))

describe('classifyContextLink', (it) => {
  it.prop(
    '∀command_LinkOutcome_∈PermittedForItsKindAndSlot',
    { of: [ClassifyContextLinkCommand], subject: outcomeOf },
    (subject, [command]) => Arr.contains(permittedOf(command), subject(command)),
  )

  it.prop(
    '∀link,facts_ListedLinkOutcome_∈PermittedForThatLink',
    { of: [ListedLink, ClassifyContextLinkCommand], subject: outcomeOf },
    (subject, [link, facts]) =>
      Option.match(onLink(LISTED_LINKS[link], facts), {
        onNone: () => false,
        onSome: (command) => Arr.contains(LISTED_LINKS[link].outcomes, subject(command)),
      }),
  )
})
