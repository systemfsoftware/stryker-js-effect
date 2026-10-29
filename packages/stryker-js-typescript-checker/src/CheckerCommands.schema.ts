import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Checker, Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { EditSiteFacts } from './edit-site.schema.js'
import { ImporterShortcutDecision } from './ImporterShortcut.schema.js'
import { TsConfigDocumentSchema } from './Tsconfig.schema.js'

const MutantBound = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(1)))
export type MutantBoundType = typeof MutantBound.Type

export class GroupMutantsCommand
  extends S.TaggedClass<GroupMutantsCommand, { readonly brand: unique symbol }>()('GroupMutantsCommand', {
    mutants: S.Array(Checker.CheckerMutantWire),
    bound: MutantBound,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class TraceAffectedFilesCommand
  extends S.TaggedClass<TraceAffectedFilesCommand, { readonly brand: unique symbol }>()(
    'TraceAffectedFilesCommand',
    {
      importsByFile: S.Record(S.String, S.Array(S.String)),
      mutatedFileNames: S.Array(S.String),
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {
    mutatedFileNames: 'stryker.typescript_checker.mutated_files',
  } as const
}

export class RequestAffectedFilesCommand
  extends S.TaggedClass<RequestAffectedFilesCommand, { readonly brand: unique symbol }>()(
    'RequestAffectedFilesCommand',
    {
      affectedFileNames: S.Array(S.String),
      presentFileNames: S.Array(S.String),
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {
    affectedFileNames: 'stryker.typescript_checker.affected_files',
  } as const
}

export class PlanDiagnosticBatchesCommand
  extends S.TaggedClass<PlanDiagnosticBatchesCommand, { readonly brand: unique symbol }>()(
    'PlanDiagnosticBatchesCommand',
    {
      fileNames: S.Array(S.String),
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {
    fileNames: 'stryker.typescript_checker.requested_files',
  } as const
}

export class CaptureAliasSpecifierCommand
  extends S.TaggedClass<CaptureAliasSpecifierCommand, { readonly brand: unique symbol }>()(
    'CaptureAliasSpecifierCommand',
    {
      pattern: S.String,
      specifier: S.String,
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {
    specifier: 'stryker.typescript_checker.specifier',
  } as const
}

export class PlanResolutionCandidatesCommand
  extends S.TaggedClass<PlanResolutionCandidatesCommand, { readonly brand: unique symbol }>()(
    'PlanResolutionCandidatesCommand',
    {
      resolved: S.String,
      extension: S.String,
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {
    resolved: 'stryker.typescript_checker.resolved_file',
  } as const
}

export class OverrideTsconfigOptionsCommand
  extends S.TaggedClass<OverrideTsconfigOptionsCommand, { readonly brand: unique symbol }>()(
    'OverrideTsconfigOptionsCommand',
    {
      document: TsConfigDocumentSchema,
      buildMode: S.Boolean,
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {
    buildMode: 'stryker.typescript_checker.build_mode',
  } as const
}

export class ParseTsconfigTextCommand
  extends S.TaggedClass<ParseTsconfigTextCommand, { readonly brand: unique symbol }>()(
    'ParseTsconfigTextCommand',
    {
      text: S.String,
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export const ContextualTypeFacts = S.Struct({
  text: S.String,
  isError: S.Boolean,
  instantiable: S.Boolean,
})
export type ContextualTypeFacts = typeof ContextualTypeFacts.Type

export const DeclaredContext = S.TaggedStruct('DeclaredContext', {})
export type DeclaredContext = typeof DeclaredContext.Type

export const CallArgument = S.TaggedStruct('CallArgument', {
  signatureCount: S.Int,
  declaredGeneric: S.Boolean,
})
export type CallArgument = typeof CallArgument.Type

export const UnenforcedContext = S.TaggedStruct('UnenforcedContext', {})
export type UnenforcedContext = typeof UnenforcedContext.Type

export const ContextOrigin = S.Union([DeclaredContext, CallArgument, UnenforcedContext])
export type ContextOrigin = typeof ContextOrigin.Type

export const SiteMissing = S.TaggedStruct('SiteMissing', {})
export type SiteMissing = typeof SiteMissing.Type

export const SiteNotExpression = S.TaggedStruct('SiteNotExpression', {})
export type SiteNotExpression = typeof SiteNotExpression.Type

export const SiteExpression = S.TaggedStruct('SiteExpression', {
  contextualType: S.OptionFromNullOr(ContextualTypeFacts),
  origin: ContextOrigin,
})
export type SiteExpression = typeof SiteExpression.Type

export const FunctionBodyKind = S.Literals(['getter', 'setter', 'constructor', 'other'])
export type FunctionBodyKind = typeof FunctionBodyKind.Type

export const SiteNotFunctionBody = S.TaggedStruct('SiteNotFunctionBody', {})
export type SiteNotFunctionBody = typeof SiteNotFunctionBody.Type

export const SiteFunctionBody = S.TaggedStruct('SiteFunctionBody', {
  functionKind: FunctionBodyKind,
  generator: S.Boolean,
  async: S.Boolean,
  returnTypeDeclared: S.Boolean,
  asyncReturnIsPromise: S.Boolean,
  target: S.OptionFromNullOr(ContextualTypeFacts),
  undefinedAssignable: S.Boolean,
  targetAllowsImplicitReturn: S.Boolean,
})
export type SiteFunctionBody = typeof SiteFunctionBody.Type

export const SiteFacts = S.Union([
  SiteMissing,
  SiteNotExpression,
  SiteExpression,
  SiteNotFunctionBody,
  SiteFunctionBody,
])
export type SiteFacts = typeof SiteFacts.Type

export const CandidateNotContextFree = S.TaggedStruct('CandidateNotContextFree', {})
export type CandidateNotContextFree = typeof CandidateNotContextFree.Type

export const CandidateMissing = S.TaggedStruct('CandidateMissing', {})
export type CandidateMissing = typeof CandidateMissing.Type

export const CandidateTyped = S.TaggedStruct('CandidateTyped', {
  candidateType: S.String,
  assignable: S.Boolean,
})
export type CandidateTyped = typeof CandidateTyped.Type

export const CandidateBodyText = S.TaggedStruct('CandidateBodyText', {
  text: S.String,
})
export type CandidateBodyText = typeof CandidateBodyText.Type

export const CandidateFacts = S.Union([CandidateNotContextFree, CandidateMissing, CandidateTyped, CandidateBodyText])
export type CandidateFacts = typeof CandidateFacts.Type

export class ClassifyCandidateCommand
  extends S.TaggedClass<ClassifyCandidateCommand, { readonly brand: unique symbol }>()(
    'ClassifyCandidateCommand',
    {
      text: S.String,
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class AnswerTypeQueryCommand extends S.TaggedClass<AnswerTypeQueryCommand, { readonly brand: unique symbol }>()(
  'AnswerTypeQueryCommand',
  {
    site: SiteFacts,
    candidate: CandidateFacts,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DecideImporterShortcutCommand
  extends S.TaggedClass<DecideImporterShortcutCommand, { readonly brand: unique symbol }>()(
    'DecideImporterShortcutCommand',
    {
      original: EditSiteFacts,
      mutated: EditSiteFacts,
      compiledElsewhere: S.Boolean,
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConcludeSharedRoundCommand
  extends S.TaggedClass<ConcludeSharedRoundCommand, { readonly brand: unique symbol }>()(
    'ConcludeSharedRoundCommand',
    {
      decisions: ImporterShortcutDecision.pipe(S.Option, S.Array),
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export const RoundCandidate = S.Struct({
  id: Mutant.MutantId,
  fileName: S.String,
  eligible: S.Boolean,
})
export type RoundCandidate = typeof RoundCandidate.Type

const roundCandidateIdsAreDistinct = S.makeFilter(
  (candidates: ReadonlyArray<RoundCandidate>): string | undefined =>
    Option.getOrUndefined(
      Option.map(
        Option.fromUndefinedOr(Mutant.duplicatedValue(candidates.map((candidate) => candidate.id))),
        (duplicated) => `round candidate ids must identify distinct mutants, got "${duplicated}"`,
      ),
    ),
  { arbitraryConstraint: { uniqueBy: (candidate: RoundCandidate) => candidate.id } },
)

export class PlanCheckRoundsCommand
  extends S.TaggedClass<PlanCheckRoundsCommand, { readonly brand: unique symbol }>()('PlanCheckRoundsCommand', {
    candidates: S.Array(RoundCandidate).check(roundCandidateIdsAreDistinct),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export const GROUP_MUTANT_BOUND: MutantBoundType = 256

const accepts = {
  mutantBound: S.is(MutantBound),
  roundCandidates: S.is(PlanCheckRoundsCommand.fields.candidates),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const isPositiveBound = (bound: number): boolean => bound >= 1
  const namesEachIdOnce = (candidates: ReadonlyArray<RoundCandidate>): boolean =>
    new Set(Arr.map(candidates, (candidate) => candidate.id)).size === candidates.length

  it.prop(
    '∀n_MutantBoundRefusal_≡BelowOne',
    { of: [S.Int], subject: accepts },
    (subject, [drawn]) =>
      Arr.every([-1, 0, 1, drawn], (bound) => subject.mutantBound(bound) === isPositiveBound(bound)),
  )

  it.prop(
    '∀c_RoundCandidatesRefusal_≡AnIdNamedTwice',
    { of: [S.Array(RoundCandidate)], subject: accepts },
    (subject, [drawn]) =>
      Arr.every(
        [drawn, Arr.appendAll(drawn, Arr.take(drawn, 1))],
        (candidates) => subject.roundCandidates(candidates) === namesEachIdOnce(candidates),
      ),
  )
}
