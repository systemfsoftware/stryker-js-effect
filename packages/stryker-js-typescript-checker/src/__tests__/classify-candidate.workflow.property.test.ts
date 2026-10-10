import { describe } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ClassificationCase,
  type ContextFreeProduction,
} from '../../tests/__fixtures__/classify-candidate-law.fixture.js'
import { ClassifyCandidateCommand } from '../CheckerCommands.schema.js'
import {
  type CandidateContextFreeness,
  classifyCandidate,
  ContextFree,
  NotContextFree,
} from '../classify-candidate.workflow.js'

const render = (production: ContextFreeProduction): string =>
  Match.value(production).pipe(
    Match.tag('StringLiteral', ({ value }) => JSON.stringify(value)),
    Match.tag('TemplateLiteral', ({ text }) => `\`${text}\``),
    Match.tag('NumericLiteral', ({ magnitude, negative }) => `${negative ? '-' : ''}${magnitude}`),
    Match.tag('BigintLiteral', ({ magnitude, negative }) => `${negative ? '-' : ''}${magnitude}n`),
    Match.tag('Keyword', ({ text }) => text),
    Match.exhaustive,
  )

const textOf = (example: ClassificationCase): string =>
  Match.value(example).pipe(
    Match.tag('Literal', ({ production }) => render(production)),
    Match.tag('Parenthesized', ({ production }) => `(${render(production)})`),
    Match.tag('SemicolonSuffixed', ({ production }) => `${render(production)};`),
    Match.tag('ArrayWrapped', ({ production }) => `[${render(production)}]`),
    Match.tag('ObjectLiteral', ({ production, key }) => `{${key}: ${render(production)}}`),
    Match.tag('ArrowFunction', ({ parameter }) => `(${parameter}) => undefined`),
    Match.exhaustive,
  )

const classifyCase = (example: ClassificationCase): Result.Result<CandidateContextFreeness, never> =>
  classifyCandidate(ClassifyCandidateCommand.make({ text: textOf(example) }))

describe('classifyCandidate', (it) => {
  it.prop(
    '∀case_Classification_≡ExpectedByCase',
    { of: [ClassificationCase], subject: classifyCase },
    (subject, [example]) =>
      Result.match(subject(example), {
        onFailure: () => false,
        onSuccess: (decision) =>
          example.expected === 'context-free' ? S.is(ContextFree)(decision) : S.is(NotContextFree)(decision),
      }),
  )
})
