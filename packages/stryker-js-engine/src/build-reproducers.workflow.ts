import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CONTEXT_LINES = 3

const maxOf = (left: number, right: number): number =>
  Boolean.match(left < right, { onTrue: () => right, onFalse: () => left })

const minOf = (left: number, right: number): number =>
  Boolean.match(left < right, { onTrue: () => left, onFalse: () => right })

export const ReproducerSchema = S.Struct({
  id: S.String,
  fileName: S.String,
  diff: S.String,
  command: S.String,
})

export type Reproducer = typeof ReproducerSchema.Type

const BuildReproducersTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/BuildReproducersDecision')
type BuildReproducersTypeId = typeof BuildReproducersTypeId

export class ReproducersBuilt extends S.TaggedClass<ReproducersBuilt>()('ReproducersBuilt', {
  reproducers: S.Array(ReproducerSchema),
}) {
  readonly [BuildReproducersTypeId] = BuildReproducersTypeId
}

export class NoMutantsToReproduce extends S.TaggedClass<NoMutantsToReproduce>()('NoMutantsToReproduce', {}) {
  readonly [BuildReproducersTypeId] = BuildReproducersTypeId
}

export const BuildReproducersDecision = S.Union([ReproducersBuilt, NoMutantsToReproduce])
export type BuildReproducersDecision = typeof BuildReproducersDecision.Type

export class BuildReproducersCommand extends S.TaggedClass<BuildReproducersCommand>()('BuildReproducersCommand', {
  report: Report.MutationTestResult,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const offsetOf = (lines: ReadonlyArray<string>, position: { readonly line: number; readonly column: number }): number =>
  Arr.reduce(Arr.take(lines, position.line - 1), 0, (total, line) => total + line.length + 1) + position.column - 1

const mutatedSourceOf = (source: string, location: Mutant.Location, replacement: string): string => {
  const lines = source.split('\n')
  const start = offsetOf(lines, location.start)
  const end = maxOf(start, offsetOf(lines, location.end))
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`
}

const firstDifferenceIndex = (pairs: ReadonlyArray<readonly [string, string]>): number =>
  Option.getOrElse(Arr.findFirstIndex(pairs, ([left, right]) => left !== right), () => pairs.length)

const prefixed = (prefix: string) => (line: string): string => `${prefix}${line}`

const hunkOf = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): string => {
  const pairs = Arr.zip(before, after)
  const prefix = firstDifferenceIndex(pairs)
  const suffix = minOf(
    firstDifferenceIndex(Arr.reverse(pairs)),
    minOf(before.length - prefix, after.length - prefix),
  )
  const leadingStart = maxOf(0, prefix - CONTEXT_LINES)
  const leading = Arr.take(Arr.drop(before, leadingStart), prefix - leadingStart)
  const removed = Arr.take(Arr.drop(before, prefix), before.length - suffix - prefix)
  const added = Arr.take(Arr.drop(after, prefix), after.length - suffix - prefix)
  const trailing = Arr.take(Arr.drop(before, before.length - suffix), minOf(CONTEXT_LINES, suffix))
  const startLine = leadingStart + 1
  const oldCount = leading.length + removed.length + trailing.length
  const newCount = leading.length + added.length + trailing.length
  const body = [
    ...Arr.map(leading, prefixed(' ')),
    ...Arr.map(removed, prefixed('-')),
    ...Arr.map(added, prefixed('+')),
    ...Arr.map(trailing, prefixed(' ')),
  ]
  return `@@ -${startLine},${oldCount} +${startLine},${newCount} @@\n${Arr.join(body, '\n')}`
}

const diffOf = (fileName: string, source: string, location: Mutant.Location, replacement: string): string => {
  const before = source.split('\n')
  const after = mutatedSourceOf(source, location, replacement).split('\n')
  return `--- a/${fileName}\n+++ b/${fileName}\n${hunkOf(before, after)}\n`
}

const reproducerOf = (fileName: string, source: string, mutant: Report.MutantResult): Reproducer => ({
  id: mutant.id,
  fileName,
  diff: diffOf(fileName, source, mutant.location, Option.getOrElse(Option.fromNullishOr(mutant.replacement), () => '')),
  command: `stryker run --mutant ${mutant.id}`,
})

const fileNameOrder = Order.mapInput(Order.String, (reproducer: Reproducer) => reproducer.fileName)
const idOrder = Order.mapInput(Order.String, (reproducer: Reproducer) => reproducer.id)

const reproducersOf = (report: Report.MutationTestResult): ReadonlyArray<Reproducer> =>
  Arr.sort(
    Arr.flatMap(Object.entries(report.files), ([fileName, file]) =>
      Arr.map(file.mutants, (mutant) => reproducerOf(fileName, file.source, mutant))),
    Order.combine(fileNameOrder, idOrder),
  )

const mutantsOf = (report: Report.MutationTestResult): ReadonlyArray<Report.MutantResult> =>
  Arr.flatMap(Object.values(report.files), (file) => file.mutants)

const decide = (command: BuildReproducersCommand): BuildReproducersDecision => {
  const mutants = mutantsOf(command.report)
  return Boolean.match(mutants.length === 0, {
    onTrue: () => NoMutantsToReproduce.make({}),
    onFalse: () => ReproducersBuilt.make({ reproducers: reproducersOf(command.report) }),
  })
}

export const buildReproducers = Workflow.make({
  command: BuildReproducersCommand,
  decision: BuildReproducersDecision,
  error: S.Never,
  decide: (command): Result.Result<BuildReproducersDecision, never> => Result.succeed(decide(command)),
})
