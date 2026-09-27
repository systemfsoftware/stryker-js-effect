import { decodeReport, DecodeReportCommand, type ReportUndecodable } from '@systemfsoftware/stryker-e2e-core'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { Effect, Result } from 'effect'

import type { SandboxForkFailure } from '../../src/Harness/harness-failure.schema.js'
import type { StrykerReadFile } from './e2e-harness.fixture.js'
import { MachineStreamError } from './machine-stream.fixture.js'

export const DEFAULT_INCREMENTAL_FILE = 'reports/stryker-incremental.json'

export const decodePersistedReport = (
  file: string,
  text: string,
): Effect.Effect<Report.MutationTestResult, ReportUndecodable> =>
  Result.match(decodeReport(DecodeReportCommand.make({ file, text })), {
    onFailure: (refused) => Effect.fail(refused),
    onSuccess: (decoded) => Effect.succeed(decoded.report),
  })

export const readPersistedReport = (
  file: string,
  readFile: StrykerReadFile,
): Effect.Effect<Report.MutationTestResult, ReportUndecodable | SandboxForkFailure> =>
  Effect.flatMap(readFile(file), (text) => decodePersistedReport(file, text))

export const readReportOf = (
  verdict: RunEvent.VerdictReached,
  readFile: StrykerReadFile,
): Effect.Effect<Report.MutationTestResult, MachineStreamError | ReportUndecodable | SandboxForkFailure> =>
  verdict.reportFile === null || verdict.reportFile === ''
    ? Effect.fail(new MachineStreamError({ line: '', detail: 'the terminal verdict carries no report file reference' }))
    : readPersistedReport(verdict.reportFile, readFile)

export const readCheckpointOf = (
  readFile: StrykerReadFile,
  incrementalFile: string = DEFAULT_INCREMENTAL_FILE,
): Effect.Effect<Report.MutationTestResult, ReportUndecodable | SandboxForkFailure> =>
  readPersistedReport(incrementalFile, readFile)
