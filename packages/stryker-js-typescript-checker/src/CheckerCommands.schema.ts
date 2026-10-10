import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { TsConfigDocumentSchema } from './Tsconfig.schema.js'

export class GroupMutantsCommand extends S.TaggedClass<GroupMutantsCommand>()('GroupMutantsCommand', {
  mutants: S.Array(Checker.CheckerMutantWire),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class TraceAffectedFilesCommand extends S.TaggedClass<TraceAffectedFilesCommand>()(
  'TraceAffectedFilesCommand',
  {
    importsByFile: S.Record(S.String, S.Array(S.String)),
    mutatedFileNames: S.Array(S.String),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    mutatedFileNames: 'stryker.typescript_checker.mutated_files',
  } as const
}

export class RequestAffectedFilesCommand extends S.TaggedClass<RequestAffectedFilesCommand>()(
  'RequestAffectedFilesCommand',
  {
    affectedFileNames: S.Array(S.String),
    presentFileNames: S.Array(S.String),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    affectedFileNames: 'stryker.typescript_checker.affected_files',
  } as const
}

export class PlanDiagnosticBatchesCommand extends S.TaggedClass<PlanDiagnosticBatchesCommand>()(
  'PlanDiagnosticBatchesCommand',
  {
    fileNames: S.Array(S.String),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    fileNames: 'stryker.typescript_checker.requested_files',
  } as const
}

export class CaptureAliasSpecifierCommand extends S.TaggedClass<CaptureAliasSpecifierCommand>()(
  'CaptureAliasSpecifierCommand',
  {
    pattern: S.String,
    specifier: S.String,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    specifier: 'stryker.typescript_checker.specifier',
  } as const
}

export class PlanResolutionCandidatesCommand extends S.TaggedClass<PlanResolutionCandidatesCommand>()(
  'PlanResolutionCandidatesCommand',
  {
    resolved: S.String,
    extension: S.String,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    resolved: 'stryker.typescript_checker.resolved_file',
  } as const
}

export class OverrideTsconfigOptionsCommand extends S.TaggedClass<OverrideTsconfigOptionsCommand>()(
  'OverrideTsconfigOptionsCommand',
  {
    document: TsConfigDocumentSchema,
    buildMode: S.Boolean,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    buildMode: 'stryker.typescript_checker.build_mode',
  } as const
}

export class ParseTsconfigTextCommand extends S.TaggedClass<ParseTsconfigTextCommand>()(
  'ParseTsconfigTextCommand',
  {
    text: S.String,
  },
) {
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

export const SiteFacts = S.Union([SiteMissing, SiteNotExpression, SiteExpression])
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

export const CandidateFacts = S.Union([CandidateNotContextFree, CandidateMissing, CandidateTyped])
export type CandidateFacts = typeof CandidateFacts.Type

export class ClassifyCandidateCommand extends S.TaggedClass<ClassifyCandidateCommand>()(
  'ClassifyCandidateCommand',
  {
    text: S.String,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class AnswerTypeQueryCommand extends S.TaggedClass<AnswerTypeQueryCommand>()(
  'AnswerTypeQueryCommand',
  {
    site: SiteFacts,
    candidate: CandidateFacts,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
