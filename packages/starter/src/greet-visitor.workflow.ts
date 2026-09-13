import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { Workflow } from '@systemfsoftware/effect-cell-types'

export class GreetVisitor extends S.TaggedClass<GreetVisitor>()('GreetVisitor', {
  name: S.String,
}) {}

const GreetingTypeId: unique symbol = Symbol.for('@TODO/starter/Greeting')
type GreetingTypeId = typeof GreetingTypeId

export class VisitorGreetedByGivenName extends S.TaggedClass<VisitorGreetedByGivenName>()(
  'VisitorGreetedByGivenName',
  { greeting: S.String },
) {
  readonly [GreetingTypeId] = GreetingTypeId
}

export class VisitorGreetedByFullName extends S.TaggedClass<VisitorGreetedByFullName>()(
  'VisitorGreetedByFullName',
  { greeting: S.String },
) {
  readonly [GreetingTypeId] = GreetingTypeId
}

export type GreetingDecision = VisitorGreetedByGivenName | VisitorGreetedByFullName

export class VisitorNameRefused extends S.TaggedError<VisitorNameRefused>()('VisitorNameRefused', {
  name: S.String,
  why: S.String,
}) {}

export const greetVisitor = Workflow.make(
  GreetVisitor,
  (command: GreetVisitor): Result.Result<GreetingDecision, VisitorNameRefused> =>
    Match.value(command.name.trim().length === 0).pipe(
      Match.when(true, () =>
        Result.fail(
          new VisitorNameRefused({
            name: command.name,
            why: 'a visitor who shares no name cannot be greeted',
          }),
        )),
      Match.when(false, () =>
        Match.value(command.name.trim().includes(' ')).pipe(
          Match.when(true, () =>
            Result.succeed(new VisitorGreetedByFullName({ greeting: `hello ${command.name.trim()}` }))),
          Match.when(false, () =>
            Result.succeed(new VisitorGreetedByGivenName({ greeting: `hello ${command.name.trim()}` }))),
          Match.exhaustive,
        )),
      Match.exhaustive,
    ),
)
