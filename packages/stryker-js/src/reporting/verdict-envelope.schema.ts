import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { ModeSignal, OutputMode } from '../output-mode.schema.js'
import { RunId, VerdictMutant } from '../run-event.schema.js'
import { StreamSchemaVersion } from './stream-version.schema.js'

export type VerdictCounts = Report.Metrics

export class VerdictEnvelope extends S.Class<VerdictEnvelope>('VerdictEnvelope')({
  schemaVersion: StreamSchemaVersion,
  runId: RunId,
  mode: OutputMode,
  signal: ModeSignal,
  score: S.NullOr(Report.Percentage),
  thresholds: Report.ThresholdsSchema,
  counts: Report.MetricsSchema,
  reportFile: S.NullOr(Mutant.CanonicalFileName),
  mutants: S.Array(VerdictMutant),
}) {}
