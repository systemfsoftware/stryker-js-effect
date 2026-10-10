import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Tool, Toolkit } from 'effect/ai'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'

import { FeedbackUnusable } from '../Feedback/Feedback.schema.js'
import { GitDiff } from '../git-diff.service.js'
import { Reporter } from '../reporter.service.js'
import { SurvivorRef } from '../surfacing.schema.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import { MutantDetail, RerunMutantFailure, ShowMutantFailure } from './mcp-tools.schema.js'

const reportDependencies = [FileSystem.FileSystem, Path.Path]

const engineDependencies = [
  FileSystem.FileSystem,
  Path.Path,
  Stdio.Stdio,
  ChildProcessSpawner.ChildProcessSpawner,
  GitDiff,
  Reporter,
  WorkerLauncher,
]

export const ListSurvivors = Tool.make('list_survivors', {
  description:
    'List the surfaced survivors of the finished mutation report, capped exactly as the CLI caps them: at most one per line and seven per file.',
  success: S.Array(SurvivorRef),
  failure: FeedbackUnusable,
  dependencies: reportDependencies,
})

export const ShowMutant = Tool.make('show_mutant', {
  description:
    "Show one mutant's status, covering tests, killing test, reproducer command, and diff against the finished mutation report.",
  parameters: S.Struct({ id: Mutant.MutantId }),
  success: MutantDetail,
  failure: ShowMutantFailure,
  dependencies: reportDependencies,
})

export const RerunMutant = Tool.make('rerun_mutant', {
  description:
    'Re-run one mutant by id through the run pipeline, restricted to that mutant, and report its fresh status, covering tests, killing test, and reproducer.',
  parameters: S.Struct({ id: Mutant.MutantId }),
  success: MutantDetail,
  failure: RerunMutantFailure,
  dependencies: engineDependencies,
})

export const ReportUsefulness = Tool.make('report_usefulness', {
  description:
    'Record a useful or not-useful judgment for one surfaced survivor. The judgment is appended to reports/mutation/feedback.jsonl as a `feedback` stream line.',
  parameters: S.Struct({
    id: Mutant.MutantId,
    judgment: RunEvent.FeedbackJudgment,
    reason: S.String.pipe(S.NullOr, S.optional),
  }),
  success: RunEvent.FeedbackReported,
  failure: FeedbackUnusable,
  dependencies: reportDependencies,
})

export const mcpToolkit = Toolkit.make(ListSurvivors, ShowMutant, RerunMutant, ReportUsefulness)
