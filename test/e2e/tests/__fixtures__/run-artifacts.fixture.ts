import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { Effect, Schema } from 'effect'

import type { SandboxForkFailure } from '../../src/Harness/harness-failure.schema.js'
import type { StrykerReadFile } from './e2e-harness.fixture.js'
import { MachineStreamError } from './machine-stream.fixture.js'

export const DEFAULT_INCREMENTAL_FILE = 'reports/stryker-incremental.json'

const decodePersistedReport = Schema.decodeEffect(Schema.fromJsonString(Report.MutationTestResult))

export const readPersistedReport = (
  file: string,
  readFile: StrykerReadFile,
): Effect.Effect<Report.MutationTestResult, Schema.SchemaError | SandboxForkFailure> =>
  Effect.flatMap(readFile(file), decodePersistedReport)

export const readReportOf = (
  verdict: RunEvent.VerdictReached,
  readFile: StrykerReadFile,
): Effect.Effect<Report.MutationTestResult, MachineStreamError | Schema.SchemaError | SandboxForkFailure> =>
  verdict.reportFile === null || verdict.reportFile === ''
    ? Effect.fail(new MachineStreamError({ line: '', detail: 'the terminal verdict carries no report file reference' }))
    : readPersistedReport(verdict.reportFile, readFile)

export const readCheckpointOf = (
  readFile: StrykerReadFile,
  incrementalFile: string = DEFAULT_INCREMENTAL_FILE,
): Effect.Effect<Report.MutationTestResult, Schema.SchemaError | SandboxForkFailure> =>
  readPersistedReport(incrementalFile, readFile)
