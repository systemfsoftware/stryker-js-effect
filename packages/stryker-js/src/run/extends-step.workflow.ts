import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type ConfigDocument,
  ConfigDocumentSchema,
  type ExtendsStepDocument,
  type ExtendsStepState,
  ExtendsStepStateSchema,
} from '../Config.schema.js'
import { mergeConfigs } from '../config/merge-config.js'

const RELATIVE_SPECIFIER_PREFIXES: readonly string[] = ['./', '../', '/', '\\']

const isModuleSpecifier = (value: string): boolean =>
  RELATIVE_SPECIFIER_PREFIXES.every((prefix) => value.startsWith(prefix) === false)

const ExtendsStepDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ExtendsStepDecision')
type ExtendsStepDecisionTypeId = typeof ExtendsStepDecisionTypeId

const configsMerge = mergeConfigs

export class ExtendsStepDone extends S.TaggedClass<ExtendsStepDone>()('done', {
  options: ConfigDocumentSchema,
}) {
  readonly [ExtendsStepDecisionTypeId] = ExtendsStepDecisionTypeId
}

export class ExtendsStepRead extends S.TaggedClass<ExtendsStepRead>()('read', {
  specifier: S.String,
  state: ExtendsStepStateSchema,
}) {
  readonly [ExtendsStepDecisionTypeId] = ExtendsStepDecisionTypeId
}

export class ExtendsStepResolve extends S.TaggedClass<ExtendsStepResolve>()('resolve', {
  specifier: S.String,
  state: ExtendsStepStateSchema,
}) {
  readonly [ExtendsStepDecisionTypeId] = ExtendsStepDecisionTypeId
}

export class ExtendsStepRefused extends S.TaggedClass<ExtendsStepRefused>()('refused', {
  reason: S.Literals(['cycle', 'non-string-extends']),
  file: S.String,
}) {
  readonly [ExtendsStepDecisionTypeId] = ExtendsStepDecisionTypeId
}

export type ExtendsStepDecision = ExtendsStepDone | ExtendsStepRead | ExtendsStepResolve | ExtendsStepRefused

export class ExtendsStepCommand extends S.TaggedClass<ExtendsStepCommand>()('ExtendsStepCommand', {
  state: ExtendsStepStateSchema,
  document: ConfigDocumentSchema,
  file: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const stripExtends = (document: Options.PartialStrykerOptions): Options.PartialStrykerOptions => {
  const { extends: _ignored, ...rest } = document
  return rest
}

const mergeChainDocuments = (documents: readonly ExtendsStepDocument[]): ConfigDocument =>
  documents.reduceRight<ConfigDocument>(
    (merged, entry) => configsMerge(merged, stripExtends(entry.options)),
    {},
  )

const nextStateOf = (
  state: ExtendsStepState,
  file: string,
  document: ConfigDocument,
): ExtendsStepState => ({
  visited: [...state.visited, file],
  documents: [...state.documents, { path: file, options: document }],
})

const doneOf = (state: ExtendsStepState): ExtendsStepDecision =>
  ExtendsStepDone.make({ options: mergeChainDocuments(state.documents) })

const extendsValueOf = (extendValue: string, state: ExtendsStepState): ExtendsStepDecision =>
  Match.value(isModuleSpecifier(extendValue)).pipe(
    Match.when(true, () => ExtendsStepResolve.make({ specifier: extendValue, state })),
    Match.when(false, () => ExtendsStepRead.make({ specifier: extendValue, state })),
    Match.exhaustive,
  )

const cycleRefusalOf = (file: string): ExtendsStepRefused => ExtendsStepRefused.make({ reason: 'cycle', file })

const nonStringRefusalOf = (file: string): ExtendsStepRefused =>
  ExtendsStepRefused.make({ reason: 'non-string-extends', file })

const advanceStepOf = (command: ExtendsStepCommand): ExtendsStepDecision => {
  const nextState = nextStateOf(command.state, command.file, command.document)
  return Match.value(command.document['extends']).pipe(
    Match.when(undefined, () => doneOf(nextState)),
    Match.when(null, () => doneOf(nextState)),
    Match.when(Match.string, (extendValue) => extendsValueOf(extendValue, nextState)),
    Match.orElse(() => nonStringRefusalOf(command.file)),
  )
}

const stepDecisionOf = (command: ExtendsStepCommand): ExtendsStepDecision =>
  Match.value(command.state.visited.includes(command.file)).pipe(
    Match.when(true, () => cycleRefusalOf(command.file)),
    Match.orElse(() => advanceStepOf(command)),
  )

const extendsStepWorkflow = Workflow.make({
  command: ExtendsStepCommand,
  decision: S.Union([ExtendsStepDone, ExtendsStepRead, ExtendsStepResolve, ExtendsStepRefused]),
  error: S.Never,
  decide: (command: ExtendsStepCommand) => Result.succeed(stepDecisionOf(command)),
})

export const extendsStep = (command: ExtendsStepCommand): ExtendsStepDecision =>
  Result.getOrElse(extendsStepWorkflow(command), (neverError) => neverError)
