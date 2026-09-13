import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import {
  GreetVisitor,
  greetVisitor,
  VisitorGreetedByFullName,
  VisitorGreetedByGivenName,
} from '../greet-visitor.workflow.js'

const REFUSAL_REASON = 'a visitor who shares no name cannot be greeted'

describe('greetVisitor', () => {
  it.prop('∀c_GreetVisitor_≡R4Greeting', [S.toArbitrary(GreetVisitor)(fc)], ([command]) => {
    const result = greetVisitor(command)
    const name = command.name.trim()
    if (name.length === 0) {
      return (
        Result.isFailure(result) &&
        result.failure.name === command.name &&
        result.failure.why === REFUSAL_REASON
      )
    }
    if (name.includes(' ')) {
      return (
        Result.isSuccess(result) &&
        S.is(VisitorGreetedByFullName)(result.success) &&
        result.success.greeting === `hello ${name}`
      )
    }
    return (
      Result.isSuccess(result) &&
      S.is(VisitorGreetedByGivenName)(result.success) &&
      result.success.greeting === `hello ${name}`
    )
  })
})
