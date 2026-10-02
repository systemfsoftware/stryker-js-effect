import { dual } from 'effect/Function'

import type { CatalogEntry } from './failure-catalog.schema.js'
import {
  type Capsule,
  type CauseLink,
  type EnvEntry,
  FailureCode,
  type FailureEvidence,
  type FailureRecord,
  type NextAction,
  type TraceId,
} from './failure-record.schema.js'

type CatalogFacts = Omit<CatalogEntry, 'id' | 'name'>

const action = (primary: NextAction['primary'], otherwise: NextAction['otherwise'] = null): NextAction => ({
  primary,
  otherwise,
})

export const FailureCatalog = {
  ArgumentsInvalid: {
    meaning: 'The command line named an option, argument or subcommand the CLI does not accept.',
    exitCode: 2,
    nextAction: action('fixConfiguration'),
    capsule: 'replays',
  },
  ConfigInvalid: {
    meaning: 'The configuration could not be read or failed validation.',
    exitCode: 2,
    nextAction: action('fixConfiguration'),
    capsule: 'replays',
  },
  PluginNotFound: {
    meaning: 'The configuration names a plugin that is not installed or not registered.',
    exitCode: 2,
    nextAction: action('fixConfiguration'),
    capsule: 'replays',
  },
  PluginLoadFailed: {
    meaning: 'A configured plugin refused to load: a peer is missing or unsupported, or its contribution is invalid.',
    exitCode: 2,
    nextAction: action('fixConfiguration'),
    capsule: 'replays',
  },
  PluginImportFailed: {
    meaning: 'A configured plugin module threw while it was being imported.',
    exitCode: 4,
    nextAction: action('reportToolDefect', 'fixConfiguration'),
    capsule: 'replays',
  },
  SurvivorsUnavailable: {
    meaning: 'Survivors were requested but no matching mutation report exists.',
    exitCode: 2,
    nextAction: action('fixConfiguration'),
    capsule: 'replays',
  },
  NoInputFiles: {
    meaning: 'The configured file patterns matched no input files.',
    exitCode: 2,
    nextAction: action('fixConfiguration'),
    capsule: 'replays',
  },
  SandboxPreparationFailed: {
    meaning: 'The project could not be read or copied into the sandbox.',
    exitCode: 3,
    nextAction: action('fixConfiguration', 'retryInfrastructure'),
    capsule: 'replays',
  },
  InstrumentationFailed: {
    meaning: 'The instrumenter could not read or mutate a source file.',
    exitCode: 3,
    nextAction: action('reportToolDefect'),
    capsule: 'replays',
  },
  CheckerFailed: {
    meaning: 'A checker failed or broke its protocol while checking mutants.',
    exitCode: 3,
    nextAction: action('fixConfiguration', 'reportToolDefect'),
    capsule: 'replays',
  },
  TestRunnerFailed: {
    meaning: 'The test runner could not be started or failed outside of any test.',
    exitCode: 3,
    nextAction: action('fixConfiguration', 'reportToolDefect'),
    capsule: 'replays',
  },
  BaselineTestsFailed: {
    meaning: 'One or more tests failed in the initial test run, before any mutant was applied.',
    exitCode: 5,
    nextAction: action('fixCode', 'fixTest'),
    capsule: 'replays',
  },
  BaselineTimedOut: {
    meaning: 'The initial test run did not finish within its time limit.',
    exitCode: 5,
    nextAction: action('fixTest', 'retryInfrastructure'),
    capsule: 'replays',
  },
  BaselineErrored: {
    meaning: 'The initial test run errored outside of any test.',
    exitCode: 5,
    nextAction: action('fixTest'),
    capsule: 'replays',
  },
  WorkerBootTimedOut: {
    meaning: 'A worker process did not finish booting before its boot window closed.',
    exitCode: 3,
    nextAction: action('retryInfrastructure', 'reportToolDefect'),
    capsule: 'replays',
  },
  BaselineFoundNoTests: {
    meaning: 'The initial test run found no tests to run.',
    exitCode: 2,
    nextAction: action('fixConfiguration'),
    capsule: 'replays',
  },
  WorkerOutOfMemory: {
    meaning: 'A worker process was killed for running out of memory.',
    exitCode: 3,
    nextAction: action('retryInfrastructure'),
    capsule: 'outOfMemory',
  },
  WorkerCrashed: {
    meaning: 'A worker process exited unexpectedly.',
    exitCode: 3,
    nextAction: action('retryInfrastructure', 'reportToolDefect'),
    capsule: 'workerCrashed',
  },
  ReporterFailed: {
    meaning: 'A reporter could not be started or failed while reporting.',
    exitCode: 3,
    nextAction: action('fixConfiguration'),
    capsule: 'replays',
  },
  RunInterrupted: {
    meaning: 'The run was interrupted by a signal before it finished.',
    exitCode: 130,
    nextAction: action('retryInfrastructure'),
    capsule: 'interrupted',
  },
  NewSurvivors: {
    meaning: 'Mutants the change can affect survived every test and are absent from the accepted survivor baseline.',
    exitCode: 1,
    nextAction: action('killSurvivor', 'refactorAwayEquivalent'),
    capsule: 'replays',
  },
  InvariantBroken: {
    meaning: 'Stryker reached a state its own design rules out; this is a defect in Stryker.',
    exitCode: 4,
    nextAction: action('reportToolDefect'),
    capsule: 'replays',
  },
  CatalogGap: {
    meaning: 'A failure no catalog entry classifies; the record carries its full cause.',
    exitCode: 4,
    nextAction: action('reportToolDefect'),
    capsule: 'replays',
  },
  RecordMissing: {
    meaning: 'A CI job ended without a failure record or a report.',
    exitCode: null,
    nextAction: action('reportToolDefect'),
    capsule: 'recordMissing',
  },
  JobTimedOut: {
    meaning: 'A CI job was killed for exceeding its time limit.',
    exitCode: null,
    nextAction: action('retryInfrastructure'),
    capsule: 'jobTimedOut',
  },
  BinaryMissing: {
    meaning: 'A CI job could not find a binary it needs.',
    exitCode: null,
    nextAction: action('fixConfiguration'),
    capsule: 'binaryMissing',
  },
} as const satisfies { readonly [Code in FailureCode]: CatalogFacts }

export interface RecordContext {
  readonly cause: ReadonlyArray<CauseLink>
  readonly cwd: string
  readonly argv: readonly [string, ...Array<string>]
  readonly env: ReadonlyArray<EnvEntry>
  readonly capsule: Capsule
  readonly traceId: TraceId | null
}

export const recordOf: {
  (context: RecordContext): (evidence: FailureEvidence) => FailureRecord
  (evidence: FailureEvidence, context: RecordContext): FailureRecord
} = dual(2, (evidence: FailureEvidence, context: RecordContext): FailureRecord => ({
  ...evidence,
  cause: context.cause,
  capsule: context.capsule,
  nextAction: FailureCatalog[evidence._tag].nextAction,
  traceId: context.traceId,
}))

export const failureCatalogEntries: ReadonlyArray<CatalogEntry> = FailureCode.literals.map((code) => ({
  id: code,
  name: code,
  ...FailureCatalog[code],
}))
