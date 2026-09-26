import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from '@systemfsoftware/vitest'
import { Match } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  CheckFinished,
  checkMutants,
  DiagnosticInUnrelatedFileError,
  DiagnosticWithoutFileError,
  RetestRequired,
} from '../check-mutants.workflow.js'
import { CheckMutantsInput } from '../CheckMutants.schema.js'

const setsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value))

const isSubset = (inner: ReadonlySet<string>, outer: ReadonlySet<string>): boolean =>
  [...inner].every((value) => outer.has(value))

const isDisjoint = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  [...left].every((value) => !right.has(value))

const fileArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 100000 }))).pipe(
  Arbitrary.map((n) => `src/mod-${n}.ts`),
)

const mutantIdArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 1000 }))).pipe(
  Arbitrary.map((n) => n.toString()),
)

const mutantInFile = (id: string, fileName: string): Checker.CheckerMutantWire =>
  Checker.CheckerMutantWire.make({
    id: Mutant.MutantId.make(id),
    fileName: Mutant.CanonicalFileName.make(fileName),
    mutatorName: Mutant.MutatorName.make('foo-mutator'),
    replacement: 'x',
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  })

const nodeFor = (
  fileName: string,
): { readonly fileName: string; readonly parents: readonly never[]; readonly children: readonly never[] } => ({
  fileName,
  parents: [],
  children: [],
})

const emptyDiagnosticsInputArb: Arbitrary.Arbitrary<CheckMutantsInput> = Arbitrary.all([
  fileArb,
  Arbitrary.array(mutantIdArb, { minLength: 1, maxLength: 2 }),
]).pipe(
  Arbitrary.map(
    ([file, ids]) =>
      CheckMutantsInput.make({
        mutants: ids.map((id) => mutantInFile(id, file)),
        diagnostics: [],
        nodes: { [file]: nodeFor(file) },
      }),
  ),
)

const ambiguousGroupInputArb: Arbitrary.Arbitrary<CheckMutantsInput> = Arbitrary.all([
  fileArb,
  Arbitrary.schema(S.String.check(S.isMaxLength(32))),
]).pipe(
  Arbitrary.map(
    ([file, text]) =>
      CheckMutantsInput.make({
        mutants: [mutantInFile('0', file), mutantInFile('1', file)],
        diagnostics: [{ fileName: file, text }],
        nodes: { [file]: nodeFor(file) },
      }),
  ),
)

describe('checkMutants', (it) => {
  it.prop(
    '∀i_Decision_≡Partitioned',
    { of: [CheckMutantsInput], subject: checkMutants },
    (subject, [input]) => {
      const result = subject(input)
      if (Result.isFailure(result)) {
        return (
          S.is(DiagnosticWithoutFileError)(result.failure) ||
          S.is(DiagnosticInUnrelatedFileError)(result.failure)
        )
      }
      const ids = new Set(input.mutants.map((mutant) => mutant.id))
      const keys = new Set(Object.keys(result.success.results))
      return Match.value(result.success).pipe(
        Match.tag('CheckFinished', () => setsEqual(keys, ids)),
        Match.tag('RetestRequired', (retry) => {
          const retest = new Set(retry.needsRetest.map((mutant) => mutant.id))
          return (
            retry.needsRetest.length > 0 &&
            isSubset(retest, ids) &&
            isDisjoint(keys, retest) &&
            setsEqual(new Set([...keys, ...retest]), ids)
          )
        }),
        Match.exhaustive,
      )
    },
  )

  it.prop('∀i_NoDiagnostics_≡CheckFinishedPassed', {
    of: [emptyDiagnosticsInputArb],
    subject: checkMutants,
  }, (subject, [input]) => {
    const result = subject(input)
    if (!Result.isSuccess(result)) {
      return false
    }
    if (!S.is(CheckFinished)(result.success)) {
      return false
    }
    const ids = new Set(input.mutants.map((mutant) => mutant.id))
    return (
      setsEqual(new Set(Object.keys(result.success.results)), ids) &&
      input.mutants.every((mutant) => result.success.results[mutant.id]?.status === 'passed')
    )
  })

  it.prop('∀i_AmbiguousGroup_≡RetestRequired', {
    of: [ambiguousGroupInputArb],
    subject: checkMutants,
  }, (subject, [input]) => {
    const result = subject(input)
    if (!Result.isSuccess(result)) {
      return false
    }
    if (!S.is(RetestRequired)(result.success)) {
      return false
    }
    const expected = new Set(input.mutants.map((mutant) => mutant.id))
    const actual = new Set(result.success.needsRetest.map((mutant) => mutant.id))
    return setsEqual(actual, expected) && isDisjoint(new Set(Object.keys(result.success.results)), actual)
  })
})
