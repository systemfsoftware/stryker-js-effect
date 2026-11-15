import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type { SelectAnnotationsDecision, SurvivorAnnotation } from './select-annotations.workflow.js'

export const annotateFailureTextOf = (reason: string): string => `stryker annotate: ${reason}`

const levelOf = (annotation: SurvivorAnnotation): 'warning' | 'notice' =>
  Match.value(annotation.status).pipe(
    Match.when('Survived', () => 'warning' as const),
    Match.when('NoCoverage', () => 'notice' as const),
    Match.exhaustive,
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

const messageOf = (annotation: SurvivorAnnotation): string =>
  Option.getOrElse(Option.fromNullishOr(annotation.mutant.description), () => annotation.mutant.mutatorName)

const lineOf = (annotation: SurvivorAnnotation): string =>
  `::${levelOf(annotation)} ${
    [
      `file=${escapePropertyValue(annotation.fileName)}`,
      `line=${annotation.mutant.location.start.line}`,
      `endLine=${annotation.mutant.location.end.line}`,
      `col=${annotation.mutant.location.start.column}`,
      `endColumn=${annotation.mutant.location.end.column}`,
      `title=${escapePropertyValue(annotation.mutant.mutatorName)}`,
    ].join(',')
  }::${escapeMessage(messageOf(annotation))}`

export const annotationLinesOf = (decision: SelectAnnotationsDecision): ReadonlyArray<string> =>
  Match.value(decision).pipe(
    Match.tag('AnnotationsSelected', (selected) => selected.annotations.map(lineOf)),
    Match.tag('NothingToAnnotate', (nothing): ReadonlyArray<string> => [
      `stryker annotate: no survivors to annotate (${nothing.survivorCount} survivors in the report)`,
    ]),
    Match.exhaustive,
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arbitrary = await import('effect/Arbitrary')
  const S = await import('effect/Schema')
  const { AnnotationsSelected, NothingToAnnotate } = await import('./select-annotations.workflow.js')

  const PROPERTY_ESCAPES: Readonly<Record<string, string>> = {
    '%': '%25',
    '\r': '%0D',
    '\n': '%0A',
    ':': '%3A',
    ',': '%2C',
  }
  const MESSAGE_ESCAPES: Readonly<Record<string, string>> = { '%': '%25', '\r': '%0D', '\n': '%0A' }

  const escapedWith = (table: Readonly<Record<string, string>>) => (value: string): string =>
    Array.from(value, (char) => table[char] ?? char).join('')

  const LEVELS = { Survived: 'warning', NoCoverage: 'notice' } as const

  const expectedLineOf = ({ fileName, status, mutant }: SurvivorAnnotation): string => {
    const level = LEVELS[status]
    const property = escapedWith(PROPERTY_ESCAPES)
    const message = escapedWith(MESSAGE_ESCAPES)(mutant.description ?? mutant.mutatorName)
    const { start, end } = mutant.location
    return `::${level} file=${
      property(fileName)
    },line=${start.line},endLine=${end.line},col=${start.column},endColumn=${end.column},title=${
      property(mutant.mutatorName)
    }::${message}`
  }

  it.prop(
    '∀a_Selected_≡OneEscapedWorkflowCommandPerAnnotationInOrder',
    {
      of: [AnnotationsSelected],
      subject: annotationLinesOf,
    },
    (subject, [selected]) => {
      const lines = subject(selected)
      const expected = selected.annotations.map(expectedLineOf)
      return lines.length === expected.length && lines.every((line, index) => line === expected[index])
    },
  )

  it.prop(
    '∀n_Nothing_≡OneLineNamingTheSurvivorCount',
    { of: [NothingToAnnotate], subject: annotationLinesOf },
    (subject, [nothing]) => {
      const lines = subject(nothing)
      const survivorCount = nothing.survivorCount
      return lines.length === 1 &&
        lines[0] === `stryker annotate: no survivors to annotate (${survivorCount} survivors in the report)`
    },
  )

  it.prop(
    '∀r_Reason_≡PrefixedWithTheCommand',
    { of: [Arbitrary.schema(S.String)], subject: annotateFailureTextOf },
    (subject, [reason]) => subject(reason) === `stryker annotate: ${reason}`,
  )
}
