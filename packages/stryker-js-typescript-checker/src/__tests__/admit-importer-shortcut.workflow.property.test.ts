import { describe } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitImporterShortcut,
  type ImporterShortcutDecision,
  ImportersRechecked,
  ShortcutTaken,
} from '../admit-importer-shortcut.workflow.js'
import {
  DecideImporterShortcutCommand,
  type EditSiteFacts,
  type FunctionLikeFacts,
  type ShortcutClause,
  type ShortcutTree,
} from '../CheckerCommands.schema.js'

interface Knobs {
  readonly offset: number
  readonly kind: number
  readonly header: string
  readonly delta: number
}

interface Overrides {
  readonly typescriptModule?: boolean
  readonly declaresGlobal?: boolean
  readonly moduleReference?: boolean
}

const OFFSET = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 10_000 })))
const KIND = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 1_000 })))
const HEADER = Arbitrary.schema(S.String)
const DELTA = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 8 })))

const SPAN_START = 10
const SPAN_END = 12
const BODY_START = 8
const BODY_END = 20

const factsAt = (
  knobs: Knobs,
  startOffset: number,
  bodyStartOffset: number,
  bodyEndOffset: number,
  bodyIndependentSignature: boolean,
  header: string,
): FunctionLikeFacts => ({
  kind: knobs.kind,
  start: knobs.offset + startOffset,
  bodyStart: knobs.offset + bodyStartOffset,
  bodyEnd: knobs.offset + bodyEndOffset,
  header,
  bodyIndependentSignature,
})

const outerOf = (knobs: Knobs, bodyEndOffset: number): FunctionLikeFacts =>
  factsAt(knobs, 0, BODY_START, bodyEndOffset, true, knobs.header)

const originalSite = (
  knobs: Knobs,
  enclosing: ReadonlyArray<FunctionLikeFacts>,
  overrides: Overrides = {},
): EditSiteFacts => ({
  span: { start: knobs.offset + SPAN_START, length: SPAN_END - SPAN_START },
  typescriptModule: true,
  declaresGlobal: false,
  moduleReference: false,
  enclosing,
  ...overrides,
})

const mutatedSite = (
  knobs: Knobs,
  enclosing: ReadonlyArray<FunctionLikeFacts>,
  overrides: Overrides = {},
): EditSiteFacts => ({
  span: { start: knobs.offset + SPAN_START, length: SPAN_END - SPAN_START + knobs.delta },
  typescriptModule: true,
  declaresGlobal: false,
  moduleReference: false,
  enclosing,
  ...overrides,
})

const shortcutCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outerOf(knobs, BODY_END)]),
    mutated: mutatedSite(knobs, [outerOf(knobs, BODY_END + knobs.delta)]),
  })

const outsideBodyCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [factsAt(knobs, 0, BODY_START, SPAN_END - 1, true, knobs.header)]),
    mutated: mutatedSite(knobs, [outerOf(knobs, BODY_END + knobs.delta)]),
  })

const dependentSignatureCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [factsAt(knobs, 0, BODY_START, BODY_END, false, knobs.header)]),
    mutated: mutatedSite(knobs, [outerOf(knobs, BODY_END + knobs.delta)]),
  })

const originalModuleCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outerOf(knobs, BODY_END)], { typescriptModule: false }),
    mutated: mutatedSite(knobs, [outerOf(knobs, BODY_END + knobs.delta)]),
  })

const originalReferenceCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outerOf(knobs, BODY_END)], { moduleReference: true }),
    mutated: mutatedSite(knobs, [outerOf(knobs, BODY_END + knobs.delta)]),
  })

const mutatedModuleCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outerOf(knobs, BODY_END)]),
    mutated: mutatedSite(knobs, [outerOf(knobs, BODY_END + knobs.delta)], { typescriptModule: false }),
  })

const mutatedReferenceCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outerOf(knobs, BODY_END)]),
    mutated: mutatedSite(knobs, [outerOf(knobs, BODY_END + knobs.delta)], { moduleReference: true }),
  })

const unmatchedMutatedCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outerOf(knobs, BODY_END)]),
    mutated: mutatedSite(knobs, []),
  })

const lengthDriftCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outerOf(knobs, BODY_END)]),
    mutated: mutatedSite(knobs, [outerOf(knobs, BODY_END + knobs.delta + 1)]),
  })

const headerDriftCommand = (knobs: Knobs): DecideImporterShortcutCommand =>
  DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outerOf(knobs, BODY_END)]),
    mutated: mutatedSite(knobs, [factsAt(knobs, 0, BODY_START, BODY_END + knobs.delta, true, knobs.header + 'x')]),
  })

const nestedCommand = (knobs: Knobs): DecideImporterShortcutCommand => {
  const innerHeader = knobs.header + '-inner'
  const outer = (bodyEndOffset: number) => outerOf(knobs, bodyEndOffset)
  const inner = (bodyEndOffset: number) => factsAt(knobs, 1, BODY_START + 1, bodyEndOffset, false, innerHeader)
  return DecideImporterShortcutCommand.make({
    original: originalSite(knobs, [outer(30), inner(15)]),
    mutated: mutatedSite(knobs, [outer(30 + knobs.delta), inner(15 + knobs.delta)]),
  })
}

interface ClauseCase {
  readonly clause: ShortcutClause
  readonly tree: ShortcutTree
  readonly build: (knobs: Knobs) => DecideImporterShortcutCommand
}

const CLAUSE_CASES: ReadonlyArray<ClauseCase> = [
  { clause: 'outside-function-body', tree: 'original', build: outsideBodyCommand },
  { clause: 'body-dependent-signature', tree: 'original', build: dependentSignatureCommand },
  { clause: 'not-typescript-module', tree: 'original', build: originalModuleCommand },
  { clause: 'module-reference', tree: 'original', build: originalReferenceCommand },
  { clause: 'not-typescript-module', tree: 'mutated', build: mutatedModuleCommand },
  { clause: 'module-reference', tree: 'mutated', build: mutatedReferenceCommand },
  { clause: 'body-dependent-signature', tree: 'mutated', build: unmatchedMutatedCommand },
  { clause: 'outside-function-body', tree: 'mutated', build: lengthDriftCommand },
]

const CASE_INDEX = Arbitrary.schema(
  S.Int.check(S.isBetween({ minimum: 0, maximum: CLAUSE_CASES.length - 1 })),
)

const knobsOf = ([offset, kind, header, delta]: readonly [number, number, string, number]): Knobs => ({
  offset,
  kind,
  header,
  delta,
})

const rechecked = (decision: ImporterShortcutDecision, clause: ShortcutClause, tree: ShortcutTree): boolean =>
  S.is(ImportersRechecked)(decision) && decision.clause === clause && decision.tree === tree

const succeeded = (decision: ImporterShortcutDecision): boolean => S.is(ShortcutTaken)(decision)

const holdsRechecked = (
  decision: Result.Result<ImporterShortcutDecision, never>,
  clause: ShortcutClause,
  tree: ShortcutTree,
): boolean => Result.match(decision, { onFailure: () => false, onSuccess: (value) => rechecked(value, clause, tree) })

const holdsSucceeded = (decision: Result.Result<ImporterShortcutDecision, never>): boolean =>
  Result.match(decision, { onFailure: () => false, onSuccess: succeeded })

describe('admitImporterShortcut', (it) => {
  it.prop(
    '∀case_FirstFailingCheck_≡NamedClauseAndTree',
    {
      of: [CASE_INDEX, OFFSET, KIND, HEADER, DELTA],
      subject: admitImporterShortcut,
    },
    (subject, [index, offset, kind, header, delta]) => {
      const chosen = CLAUSE_CASES[index]
      if (chosen === undefined) return false
      return holdsRechecked(subject(chosen.build(knobsOf([offset, kind, header, delta]))), chosen.clause, chosen.tree)
    },
  )

  it.prop(
    '∀knobs_AllChecksHold_≡ShortcutTaken',
    { of: [OFFSET, KIND, HEADER, DELTA], subject: admitImporterShortcut },
    (subject, [offset, kind, header, delta]) =>
      holdsSucceeded(subject(shortcutCommand(knobsOf([offset, kind, header, delta])))),
  )

  it.prop(
    '∀knobs_HeaderDiffers_≡RecheckedBodyDependentSignatureOnMutated',
    { of: [OFFSET, KIND, HEADER, DELTA], subject: admitImporterShortcut },
    (subject, [offset, kind, header, delta]) =>
      holdsRechecked(
        subject(headerDriftCommand(knobsOf([offset, kind, header, delta]))),
        'body-dependent-signature',
        'mutated',
      ),
  )

  it.prop(
    '∀knobs_SpanInsideUnannotatedInnerInsideAnnotatedOuter_≡ShortcutTaken',
    { of: [OFFSET, KIND, HEADER, DELTA], subject: admitImporterShortcut },
    (subject, [offset, kind, header, delta]) =>
      holdsSucceeded(subject(nestedCommand(knobsOf([offset, kind, header, delta])))),
  )

  it.prop(
    '∀knobs_MutatedBodyLengthOffByOne_≡RecheckedOutsideFunctionBodyOnMutated',
    { of: [OFFSET, KIND, HEADER, DELTA], subject: admitImporterShortcut },
    (subject, [offset, kind, header, delta]) =>
      holdsRechecked(
        subject(lengthDriftCommand(knobsOf([offset, kind, header, delta]))),
        'outside-function-body',
        'mutated',
      ),
  )
})
