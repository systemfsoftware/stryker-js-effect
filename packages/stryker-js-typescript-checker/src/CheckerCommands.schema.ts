import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { SourceFileSchema, TSFileNodeSchema } from './CheckMutants.schema.js'

export class GroupMutantsCommand extends S.TaggedClass<GroupMutantsCommand>()('GroupMutantsCommand', {
  mutants: S.Array(Checker.CheckerMutantWire),
  nodes: S.Record(SourceFileSchema, TSFileNodeSchema),
  prioritizePerformanceOverAccuracy: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    prioritizePerformanceOverAccuracy: 'stryker.typescript_checker.prioritize_performance',
  } as const
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
    document: S.Record(S.String, S.Unknown),
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
