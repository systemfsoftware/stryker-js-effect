import { OutputMode, RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class VerdictEnvelope extends S.Class<VerdictEnvelope>('VerdictEnvelope')({
  schemaVersion: RunEvent.StreamSchemaVersion,
  runId: RunEvent.RunId,
  mode: OutputMode.OutputMode,
  signal: OutputMode.ModeSignal,
  score: S.NullOr(Report.Percentage),
  thresholds: Report.Thresholds,
  counts: Report.MetricsSchema,
  reportFile: S.NullOr(Mutant.CanonicalFileName),
  mutants: S.Array(RunEvent.VerdictMutant),
}) {}
