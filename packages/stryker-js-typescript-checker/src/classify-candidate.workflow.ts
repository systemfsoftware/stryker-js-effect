import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ClassifyCandidateCommand } from './CheckerCommands.schema.js'

const ContextFreenessTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-typescript-checker/CandidateContextFreeness',
)
type ContextFreenessTypeId = typeof ContextFreenessTypeId

export class ContextFree extends S.TaggedClass<ContextFree>()('ContextFree', {}) {
  readonly [ContextFreenessTypeId] = ContextFreenessTypeId
}

export class NotContextFree extends S.TaggedClass<NotContextFree>()('NotContextFree', {}) {
  readonly [ContextFreenessTypeId] = ContextFreenessTypeId
}

export const CandidateContextFreeness = S.Union([ContextFree, NotContextFree])
export type CandidateContextFreeness = typeof CandidateContextFreeness.Type

const DOUBLE_QUOTED_STRING_LITERAL = /^"(?:[^"\\]|\\.)*"$/

const SINGLE_QUOTED_STRING_LITERAL = /^'(?:[^'\\]|\\.)*'$/

const NO_SUBSTITUTION_TEMPLATE_LITERAL = /^`[^`\\$]*`$/

const NUMERIC_LITERAL = /^-?[0-9]+$/

const BIGINT_LITERAL = /^-?[0-9]+n$/

const LITERAL_KEYWORDS: Record<string, true> = {
  true: true,
  false: true,
  null: true,
  undefined: true,
  '{}': true,
  '() => undefined': true,
  '() => {}': true,
}

const CONTEXT_FREE_PATTERNS: ReadonlyArray<RegExp> = [
  DOUBLE_QUOTED_STRING_LITERAL,
  SINGLE_QUOTED_STRING_LITERAL,
  NO_SUBSTITUTION_TEMPLATE_LITERAL,
  NUMERIC_LITERAL,
  BIGINT_LITERAL,
]

const isContextFree = (text: string): boolean =>
  Boolean.or(LITERAL_KEYWORDS[text] === true, Arr.some(CONTEXT_FREE_PATTERNS, (pattern) => pattern.test(text)))

const classifyOf = (text: string): CandidateContextFreeness =>
  Boolean.match(isContextFree(text), {
    onTrue: () => ContextFree.make({}),
    onFalse: () => NotContextFree.make({}),
  })

const decide = (command: ClassifyCandidateCommand): Result.Result<CandidateContextFreeness, never> =>
  Result.succeed(classifyOf(command.text))

export const classifyCandidate = Workflow.make({
  command: ClassifyCandidateCommand,
  decision: CandidateContextFreeness,
  error: S.Never,
  decide,
})
