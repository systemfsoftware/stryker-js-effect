import { type Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  buildReproducers,
  BuildReproducersCommand,
  NoMutantsToReproduce,
  type Reproducer,
  ReproducersBuilt,
} from '../build-reproducers.workflow.js'

type Subject = typeof buildReproducers

interface MutantAt {
  readonly fileName: string
  readonly source: string
  readonly mutant: Report.MutantResult
}

const mutantsOf = (report: Report.MutationTestResult): ReadonlyArray<MutantAt> =>
  Arr.flatMap(
    Object.entries(report.files),
    ([fileName, file]) => Arr.map(file.mutants, (mutant): MutantAt => ({ fileName, source: file.source, mutant })),
  )

const offsetOf = (lines: ReadonlyArray<string>, position: { readonly line: number; readonly column: number }): number =>
  lines.slice(0, position.line - 1).reduce((total, line) => total + line.length + 1, position.column - 1)

const mutatedSourceOf = (source: string, mutant: Report.MutantResult): string => {
  const lines = source.split('\n')
  const start = offsetOf(lines, mutant.location.start)
  const end = Math.max(start, offsetOf(lines, mutant.location.end))
  return `${source.slice(0, start)}${mutant.replacement ?? ''}${source.slice(end)}`
}

const applyDiff = (source: string, diff: string): string => {
  const lines = diff.split('\n')
  const headerIndex = lines.findIndex((line) => line.startsWith('@@'))
  const start = Number(/^@@ -(\d+),\d+ \+\d+,\d+ @@$/.exec(lines[headerIndex] ?? '')?.[1] ?? '1') - 1
  const body = lines.slice(headerIndex + 1).filter((line) => line.length > 0)
  const oldBlock = body.filter((line) => line.startsWith(' ') || line.startsWith('-')).map((line) => line.slice(1))
  const newBlock = body.filter((line) => line.startsWith(' ') || line.startsWith('+')).map((line) => line.slice(1))
  const sourceLines = source.split('\n')
  return [...sourceLines.slice(0, start), ...newBlock, ...sourceLines.slice(start + oldBlock.length)].join('\n')
}

const decisionOf = (subject: Subject, command: BuildReproducersCommand) => subject(command).pipe(Result.getOrThrow)

const reproducersOf = (subject: Subject, command: BuildReproducersCommand): ReadonlyArray<Reproducer> =>
  Match.value(decisionOf(subject, command)).pipe(
    Match.tag('ReproducersBuilt', (built) => built.reproducers),
    Match.tag('NoMutantsToReproduce', (): ReadonlyArray<Reproducer> => []),
    Match.exhaustive,
  )

const reproduces = (reproducer: Reproducer, at: MutantAt): boolean =>
  reproducer.fileName === at.fileName &&
  reproducer.id === at.mutant.id &&
  applyDiff(at.source, reproducer.diff) === mutatedSourceOf(at.source, at.mutant)

describe('buildReproducers', () => {
  it.prop(
    '∀c_BuildReproducersCommand_≡ApplyingAMutantsReproducerDiffYieldsItsMutatedSource',
    { of: [BuildReproducersCommand], subject: buildReproducers },
    (subject, [command]) => {
      const mutants = mutantsOf(command.report)
      const reproducers = reproducersOf(subject, command)
      return reproducers.length === mutants.length &&
        Arr.every(mutants, (at) => Arr.some(reproducers, (reproducer) => reproduces(reproducer, at)))
    },
  )

  it.prop(
    '∀c_BuildReproducersCommand_≡EveryReproducerBelongsToAMutantOfTheReport',
    { of: [BuildReproducersCommand], subject: buildReproducers },
    (subject, [command]) =>
      Arr.every(
        reproducersOf(subject, command),
        (reproducer) => Arr.some(mutantsOf(command.report), (at) => reproduces(reproducer, at)),
      ),
  )

  it.prop(
    '∀c_BuildReproducersCommand_≡EveryReproducerNamesItsMutantToRerun',
    { of: [BuildReproducersCommand], subject: buildReproducers },
    (subject, [command]) =>
      Arr.every(
        reproducersOf(subject, command),
        (reproducer) => reproducer.command === `stryker run --mutant ${reproducer.id}`,
      ),
  )

  it.prop(
    '∀c_BuildReproducersCommand_≡AMutantFreeReportDeclaresNothingToReproduce',
    { of: [BuildReproducersCommand], subject: buildReproducers },
    (subject, [command]) => {
      const mutants = mutantsOf(command.report)
      const decision = decisionOf(subject, command)
      return mutants.length === 0
        ? S.is(NoMutantsToReproduce)(decision)
        : S.is(ReproducersBuilt)(decision)
    },
  )
})
