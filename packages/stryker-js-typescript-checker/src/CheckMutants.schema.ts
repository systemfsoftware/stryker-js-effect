/// <reference types="vitest/importMeta" />
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Checker, Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const SourceFileSchema = S.NonEmptyString.pipe(S.check(S.isPattern(/\.[^./\\]+$/u)))

export const DiagnosticSeveritySchema = S.Literals(['error', 'warning', 'suggestion', 'message'])
export type DiagnosticSeverity = S.Schema.Type<typeof DiagnosticSeveritySchema>

export class DiagnosticLine extends S.Class<DiagnosticLine>('DiagnosticLine')({
  fileName: S.optional(SourceFileSchema),
  position: S.String,
  severity: DiagnosticSeveritySchema,
  code: S.Finite,
  text: S.String,
}) {
  get rendered(): string {
    return this.position + this.severity + ' TS' + this.code + ': ' + this.text
  }
}

export interface NodeDecodedShape {
  readonly fileName: string
  readonly parents: readonly NodeDecodedShape[]
  readonly children: readonly NodeDecodedShape[]
}

export class MutantVerdict extends S.Class<MutantVerdict>('MutantVerdict')({
  id: Mutant.MutantId,
  diagnostics: S.Array(DiagnosticLine),
}) {}

export class CheckMutantsInput extends S.TaggedClass<CheckMutantsInput>()(
  'CheckMutantsInput',
  {
    mutants: S.Array(Checker.CheckerMutantWire),
    verdicts: S.Array(MutantVerdict),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export type MutantDecoded = Checker.CheckerMutantWire
export type DiagnosticDecoded = DiagnosticLine
export type NodeDecoded = NodeDecodedShape

const accepts = {
  sourceFile: S.is(SourceFileSchema),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const seeds = ['', '.', 'a', 'a.', '/a', 'a/b', 'a/b.', 'file.ts', 'index.d.ts', '.hidden']
  const isSourceFileName = (value: string): boolean => value !== '' && /\.[^./\\]+$/.test(value)

  it.prop(
    '∀s_SourceFileRefusal_≡NonEmptyExtension',
    { of: [S.String], subject: accepts },
    (subject, [value]) =>
      Arr.every(Arr.append(seeds, value), (candidate) => subject.sourceFile(candidate) === isSourceFileName(candidate)),
  )
}
