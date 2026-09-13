import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import * as Result from 'effect/Result'
import { expect } from 'vitest'

import {
  GreetVisitor,
  greetVisitor,
  VisitorGreetedByFullName,
  VisitorGreetedByGivenName,
  VisitorNameRefused,
} from '@TODO/starter'

const Feature = makeFeature({ it, layer })

Feature('Greeting visitors by name').body(({ scenario }) => {
  scenario(
    'A visitor who shared a given name is greeted by it',
    Gherkin.Do.pipe(
      Given('a visitor arrived with the name "world"')(
        'command',
        () => Effect.succeed(new GreetVisitor({ name: 'world' })),
      ),
      When('the host greets the visitor')('decision', (s) => Effect.succeed(greetVisitor(s.command))),
      Then('the greeting addresses the visitor by name')((s) => {
        const decision = Result.getOrThrow(s.decision)
        expect(decision).toBeInstanceOf(VisitorGreetedByGivenName)
        expect(decision.greeting).toBe('hello world')
      }),
    ),
  )

  scenario(
    'A visitor who shared a full name is greeted by the whole name',
    Gherkin.Do.pipe(
      Given('a visitor arrived with the name "Ada Lovelace"')(
        'command',
        () => Effect.succeed(new GreetVisitor({ name: 'Ada Lovelace' })),
      ),
      When('the host greets the visitor')('decision', (s) => Effect.succeed(greetVisitor(s.command))),
      Then('the greeting uses the full name the visitor shared')((s) => {
        const decision = Result.getOrThrow(s.decision)
        expect(decision).toBeInstanceOf(VisitorGreetedByFullName)
        expect(decision.greeting).toBe('hello Ada Lovelace')
      }),
    ),
  )

  scenario(
    'A visitor who shared no name is turned away',
    Gherkin.Do.pipe(
      Given('a visitor arrived with the name "   "')(
        'command',
        () => Effect.succeed(new GreetVisitor({ name: '   ' })),
      ),
      When('the host greets the visitor')('decision', (s) => Effect.succeed(greetVisitor(s.command))),
      Then('the visitor is refused for having no name')((s) => {
        if (Result.isFailure(s.decision)) {
          expect(s.decision.failure).toBeInstanceOf(VisitorNameRefused)
          expect(s.decision.failure.name).toBe('   ')
          expect(s.decision.failure.why).toBe('a visitor who shares no name cannot be greeted')
          return
        }
        expect.fail('the greeting was expected to be refused')
      }),
    ),
  )
})
