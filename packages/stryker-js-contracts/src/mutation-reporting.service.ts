import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import {
  type Checker,
  Mutant,
  type Options,
  type Plugin,
  type TestRunner,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type { PlatformError } from 'effect/PlatformError'

import type { TimeoutEvidence } from './IncrementalDiff.schema.js'
import type { ResolvedMode } from './output-mode.schema.js'
import type { Project } from './Project.schema.js'
import type { TestCoverage } from './test-coverage.schema.js'

export const ReporterStageTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ReporterStage')

/**
 * An attached reporter stage, opaque at the engine boundary: the published
 * phase types carry this handle so the attachment machinery (queues, fibers,
 * the state latch) never reaches an adopter's compiler. Constructed only by
 * `attachReporterFactories`.
 */
export interface ReporterStage {
  readonly [ReporterStageTypeId]: typeof ReporterStageTypeId
}

export interface MutationTestDone {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly verdict: Plugin.ExitClass | null
}

export interface MutationReportingInput {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly options: Options.StrykerOptions
  readonly project: Project
  readonly testCoverage: TestCoverage
  readonly runId: string
  readonly resolvedMode: ResolvedMode
  readonly basePath: string
  readonly reporterStage: ReporterStage
  readonly formatRegistry: Format.FormatRegistry
  readonly timeOverheadMs: number
  readonly closureDigestsByMutantId?: Readonly<Record<string, string>>
  readonly timeoutEvidenceByMutantId?: Readonly<Record<string, TimeoutEvidence>>
  readonly rememberedMutantIds: ReadonlyArray<string>
  readonly programDigest?: string
  readonly concurrency: number
  readonly runStartedAt: number
}

export interface MutationReportingService {
  readonly reportCheckFailure: (
    mutant: Mutant.MutantTestCoverage,
    result: Checker.FailedCheckResult,
  ) => Effect.Effect<Mutant.RunMutantResult>
  readonly reportIgnored: (
    mutant: Mutant.MutantTestCoverage,
    result: Checker.IgnoredCheckResult,
  ) => Effect.Effect<Mutant.RunMutantResult>
  readonly reportNoCoverage: (mutant: Mutant.MutantTestCoverage) => Effect.Effect<Mutant.RunMutantResult>
  readonly reportMutantRunResult: (
    mutant: Mutant.MutantTestCoverage,
    result: TestRunner.MutantRunResult,
  ) => Effect.Effect<Mutant.RunMutantResult>
  readonly reportAll: (input: MutationReportingInput) => Effect.Effect<MutationTestDone, PlatformError>
  readonly checkpoint: (
    input: MutationReportingInput,
    plannedMutants: readonly Mutant.Mutant[],
  ) => Effect.Effect<void, PlatformError>
  readonly publishDryRunCoverage: (input: MutationReportingInput) => Effect.Effect<void, PlatformError>
}

export class MutationReporting extends Context.Service<MutationReporting, MutationReportingService>()(
  '@systemfsoftware/stryker-js/mutation-reporting.service/MutationReporting',
) {}
