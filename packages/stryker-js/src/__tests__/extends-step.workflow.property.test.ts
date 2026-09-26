import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { type ConfigDocument, ExtendsStepStateSchema } from '../Config.schema.js'
import { mergeConfigs } from '../config/merge-config.js'
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

interface ChainEntry {
  readonly path: string
  readonly options: ConfigDocument
}

const stripExtends = (document: Options.PartialStrykerOptions): Options.PartialStrykerOptions => {
  const { extends: _ignored, ...rest } = document
  return rest
}

const referenceChainOptions = (documents: readonly ChainEntry[]): ConfigDocument =>
  documents.reduceRight<ConfigDocument>((merged, entry) => mergeConfigs(merged, stripExtends(entry.options)), {})

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
        const expected = referenceChainOptions([
          ...command.state.documents,
          { path: command.file, options: { ...command.document } },
        ])
        return S.is(ExtendsStepDone)(decision) && Equal.equals(decision.options, expected)
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
      if (S.is(ExtendsStepDone)(decision)) {
        const marker = { marker: command.file }
        const appended = subject(
          ExtendsStepCommand.make({
            state: command.state,
            document: { ...command.document, ...marker },
            file: command.file,
          }),
        )
        const expected = referenceChainOptions([
          ...command.state.documents,
          { path: command.file, options: { ...command.document, ...marker } },
        ])
        return S.is(ExtendsStepDone)(appended) && Equal.equals(appended.options, expected)
      }
      return decision.state.visited.length === command.state.visited.length + 1 &&
        decision.state.documents.length === command.state.documents.length + 1 &&
        decision.state.documents.at(-1)?.path === command.file
    },
  )
})
