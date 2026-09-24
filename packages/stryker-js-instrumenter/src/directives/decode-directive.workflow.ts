import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type Directive, DirectiveSchema } from './directive.schema.js'

const DIRECTIVE_PATTERN = /^\s?Stryker (disable|restore)(?: (next-line))? ([a-zA-Z, ]+)(?::(.+)?)?/
const DEFAULT_REASON = 'Ignored using a comment'
const NEXT_LINE = 'next-line'

export const StrykerCommentSchema = S.Struct({
  clause: S.Literals([
    ' Stryker disable',
    ' Stryker restore',
    ' Stryker disable next-line',
    ' Stryker restore next-line',
    ' Stryker enable',
    ' nothing',
  ]),
  nameLetters: S.Array(S.Literals(['a', 'b', 'Z', ',', ' '])).check(S.isMinLength(1)),
})
export type StrykerComment = typeof StrykerCommentSchema.Type

export class DecodeDirectiveCommand extends S.TaggedClass<DecodeDirectiveCommand>()('DecodeDirectiveCommand', {
  commentText: S.String,
}) {}

const DirectiveDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-instrumenter/DirectiveDecision')
type DirectiveDecisionTypeId = typeof DirectiveDecisionTypeId

export class DirectiveDecoded extends S.TaggedClass<DirectiveDecoded>()('DirectiveDecoded', {
  directive: DirectiveSchema,
}) {
  readonly [DirectiveDecisionTypeId] = DirectiveDecisionTypeId
}

export class DirectiveMalformed extends S.TaggedClass<DirectiveMalformed>()('DirectiveMalformed', {
  commentText: S.String,
}) {
  readonly [DirectiveDecisionTypeId] = DirectiveDecisionTypeId
}

export type DirectiveDecision = DirectiveDecoded | DirectiveMalformed

const actionOf = (action: string): Directive['action'] =>
  Match.value(action).pipe(
    Match.when('restore', (): Directive['action'] => 'restore'),
    Match.orElse((): Directive['action'] => 'disable'),
  )

const scopeOf = (nextLine: Option.Option<string>): Directive['scope'] =>
  Match.value(Option.isSome(nextLine)).pipe(
    Match.when(true, (): Directive['scope'] => NEXT_LINE),
    Match.when(false, (): Directive['scope'] => 'block'),
    Match.exhaustive,
  )

const reasonOf = (reason: Option.Option<string>): string =>
  Option.getOrElse(
    Option.filter(Option.map(reason, (text) => text.trim()), (text) => text.length > 0),
    () => DEFAULT_REASON,
  )

const mutatorNamesOf = (mutators: string): readonly string[] =>
  mutators
    .split(',')
    .map((mutatorName) => mutatorName.trim().replace(/\s+/g, ' '))
    .filter((mutatorName) => mutatorName.length > 0)

const decodedDirective = (match: RegExpExecArray): Option.Option<Directive> =>
  Option.flatMap(Option.fromNullishOr(match[1]), (action) =>
    Option.flatMap(
      Option.filter(Option.fromNullishOr(match[3]), (mutators) => mutatorNamesOf(mutators).length > 0),
      (mutators): Option.Option<Directive> =>
        Option.some({
          action: actionOf(action),
          scope: scopeOf(Option.fromNullishOr(match[2])),
          mutatorNames: mutatorNamesOf(mutators),
          reason: reasonOf(Option.fromNullishOr(match[4])),
        }),
    ))

export const decodeDirective = Workflow.total(
  DecodeDirectiveCommand,
  (command: DecodeDirectiveCommand): Result.Result<DirectiveDecision, never> =>
    Match.value(
      Option.flatMap(Option.fromNullishOr(DIRECTIVE_PATTERN.exec(command.commentText)), decodedDirective),
    ).pipe(
      Match.when(Option.isSome, (decoded) => Result.succeed(new DirectiveDecoded({ directive: decoded.value }))),
      Match.when(Option.isNone, () => Result.succeed(new DirectiveMalformed({ commentText: command.commentText }))),
      Match.exhaustive,
    ),
)
