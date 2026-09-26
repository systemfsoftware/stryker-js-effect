import { describe, it } from '@systemfsoftware/vitest'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { ExtendsStepStateSchema } from '../Config.schema.js'
import {
  extendsStep,
  ExtendsStepCommand,
  ExtendsStepDone,
  ExtendsStepRead,
  ExtendsStepRefused,
  ExtendsStepResolve,
} from '../run/extends-step.workflow.js'

const RELATIVE_PREFIXES: readonly string[] = ['./', '../', '/', '\\']

const isRelativeSpecifier = (value: string): boolean => RELATIVE_PREFIXES.some((prefix) => value.startsWith(prefix))

const stateArb = Arbitrary.schema(ExtendsStepStateSchema)

const documentArb = Arbitrary.schema(
  S.Struct({
    extends: S.optional(
      S.Union([S.Undefined, S.Null, S.String, S.Finite, S.Boolean]),
    ),
  }),
)

const commandArb = Arbitrary.all({
  state: stateArb,
  file: Arbitrary.schema(S.String),
  document: documentArb,
}).pipe(
  Arbitrary.map(({ state, file, document }) => ExtendsStepCommand.make({ state, document, file })),
)

const cyclicCommandArb = Arbitrary.all({
  state: stateArb,
  file: Arbitrary.schema(S.String),
  document: documentArb,
}).pipe(
  Arbitrary.map(({ state, file, document }) =>
    ExtendsStepCommand.make({
      state: { visited: [...state.visited, file], documents: state.documents },
      document,
      file,
    })
  ),
)

describe('extendsStep', () => {
  it.prop(
    '∀c_Visited_≡CycleIsRefused',
    { of: [cyclicCommandArb], subject: extendsStep },
    (subject, [command]) => {
      const decision = subject(command)
      return S.is(ExtendsStepRefused)(decision) && decision.reason === 'cycle' && decision.file === command.file
    },
  )

  it.prop(
    '∀c_Extends_≡ValueShapePicksTheStep',
    { of: [commandArb], subject: extendsStep },
    (subject, [command]) => {
      const decision = subject(command)
      if (command.state.visited.includes(command.file)) {
        return S.is(ExtendsStepRefused)(decision) && decision.reason === 'cycle'
      }
      const extendValue = command.document['extends']
      if (extendValue === undefined || extendValue === null) {
        return S.is(ExtendsStepDone)(decision) && decision.state.visited.at(-1) === command.file
      }
      if (typeof extendValue !== 'string') {
        return S.is(ExtendsStepRefused)(decision) &&
          decision.reason === 'non-string-extends' &&
          decision.file === command.file
      }
      if (isRelativeSpecifier(extendValue)) {
        return S.is(ExtendsStepRead)(decision) && decision.specifier === extendValue
      }
      return S.is(ExtendsStepResolve)(decision) && decision.specifier === extendValue
    },
  )

  it.prop(
    '∀c_Extends_≡NextStateAppendsTheReadFile',
    { of: [commandArb], subject: extendsStep },
    (subject, [command]) => {
      const decision = subject(command)
      if (S.is(ExtendsStepRefused)(decision)) {
        return true
      }
      return decision.state.visited.length === command.state.visited.length + 1 &&
        decision.state.documents.length === command.state.documents.length + 1 &&
        decision.state.documents.at(-1)?.path === command.file
    },
  )
})
