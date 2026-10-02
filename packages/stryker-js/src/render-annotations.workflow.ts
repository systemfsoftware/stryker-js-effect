import { Workflow } from '@systemfsoftware/effect-cell-types'
import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { SurvivorRef } from './surfacing.schema.js'

const MUTANT_STATUSES = S.Literals([
  'CompileError',
  'Ignored',
  'Killed',
  'NoCoverage',
  'Pending',
  'RuntimeError',
  'Survived',
  'Timeout',
])
const SURVIVOR_LEVELS: Record<string, 'warning' | 'notice'> = { Survived: 'warning', NoCoverage: 'notice' }

const decodeMutantStatus = S.decodeOption(MUTANT_STATUSES)

export class AnnotationsUnusable extends S.TaggedError<AnnotationsUnusable>()('AnnotationsUnusable', {
  reason: S.String,
}) {
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'ConfigInvalid', stage: 'config', detail: this.reason }
  }

  override get message(): string {
    return `stryker annotate: ${this.reason}`
  }
}

const RenderAnnotationsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RenderAnnotationsDecision')
type RenderAnnotationsTypeId = typeof RenderAnnotationsTypeId

export class AnnotationsRendered extends S.TaggedClass<AnnotationsRendered>()('AnnotationsRendered', {
  lines: S.Array(S.String),
}) {
  readonly [RenderAnnotationsTypeId] = RenderAnnotationsTypeId
}

export class NothingToAnnotate extends S.TaggedClass<NothingToAnnotate>()('NothingToAnnotate', {
  survivorCount: S.Natural,
}) {
  readonly [RenderAnnotationsTypeId] = RenderAnnotationsTypeId
}

export const RenderAnnotationsDecision = S.Union([AnnotationsRendered, NothingToAnnotate])
export type RenderAnnotationsDecision = typeof RenderAnnotationsDecision.Type

export class RenderAnnotationsCommand extends S.TaggedClass<RenderAnnotationsCommand>()('RenderAnnotationsCommand', {
  report: Report.MutationTestResult,
  survivors: S.Array(SurvivorRef),
  baseline: S.Array(Mutant.MutantId),
  failureAnnotations: S.String.pipe(S.Array, S.optional),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface AnnotationEntry {
  readonly fileName: string
  readonly mutant: Report.MutantResult
  readonly level: 'warning' | 'notice'
  readonly id: string
}

const entryOf = (fileName: string, mutant: Report.MutantResult): Option.Option<AnnotationEntry> =>
  Option.flatMap(
    decodeMutantStatus(mutant.status),
    (status) =>
      Option.map(
        Option.fromNullishOr(SURVIVOR_LEVELS[status]),
        (level): AnnotationEntry => ({ fileName, mutant, level, id: mutant.id }),
      ),
  )

const entriesByIdOf = (report: Report.MutationTestResult): HashMap.HashMap<string, AnnotationEntry> =>
  HashMap.fromIterable(
    Arr.flatMap(
      Object.entries(report.files),
      ([fileName, file]) =>
        Arr.flatMap(file.mutants, (mutant) =>
          Option.toArray(
            Option.map(entryOf(fileName, mutant), (entry): readonly [string, AnnotationEntry] => [mutant.id, entry]),
          )),
    ),
  )

const escapePropertyValue = (value: string): string =>
  value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C')

const escapeMessage = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

const messageOf = (entry: AnnotationEntry): string =>
  Option.getOrElse(Option.fromNullishOr(entry.mutant.description), () => entry.mutant.mutatorName)

const lineOf = (entry: AnnotationEntry): string =>
  `::${entry.level} ${
    [
      `file=${escapePropertyValue(entry.fileName)}`,
      `line=${entry.mutant.location.start.line}`,
      `endLine=${entry.mutant.location.end.line}`,
      `col=${entry.mutant.location.start.column}`,
      `endColumn=${entry.mutant.location.end.column}`,
      `title=${escapePropertyValue(entry.mutant.mutatorName)}`,
    ].join(',')
  }::${escapeMessage(messageOf(entry))}`

const survivorLinesOf = (
  report: Report.MutationTestResult,
  survivors: ReadonlyArray<SurvivorRef>,
  baseline: ReadonlyArray<Mutant.MutantId>,
): ReadonlyArray<string> => {
  const byId = entriesByIdOf(report)
  const baselineSet = HashSet.fromIterable(baseline)
  return Arr.flatMap(
    survivors,
    (ref) =>
      Boolean.match(HashSet.has(baselineSet, ref.id), {
        onTrue: (): ReadonlyArray<string> => [],
        onFalse: () => Arr.flatMap(Option.toArray(HashMap.get(byId, ref.id)), (entry) => [lineOf(entry)]),
      }),
  )
}

const linesOf = (command: RenderAnnotationsCommand): ReadonlyArray<string> => [
  ...survivorLinesOf(command.report, command.survivors, command.baseline),
  ...Option.fromUndefinedOr(command.failureAnnotations).pipe(Option.getOrElse((): ReadonlyArray<string> => [])),
]

const decide = (command: RenderAnnotationsCommand): RenderAnnotationsDecision => {
  const lines = linesOf(command)
  return Boolean.match(Arr.length(lines) === 0, {
    onTrue: () => NothingToAnnotate.make({ survivorCount: Arr.length(command.survivors) }),
    onFalse: () => AnnotationsRendered.make({ lines }),
  })
}

export const renderAnnotations = Workflow.make({
  command: RenderAnnotationsCommand,
  decision: RenderAnnotationsDecision,
  error: S.Never,
  decide: (command): Result.Result<RenderAnnotationsDecision, never> => Result.succeed(decide(command)),
})
