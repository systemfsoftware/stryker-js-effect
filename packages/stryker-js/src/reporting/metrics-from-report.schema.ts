import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class MetricsResultFromReport extends S.Class<MetricsResultFromReport, Report.MetricsResultEncoded>(
  'MetricsResultFromReport',
)({
  name: S.String,
  metrics: Report.Metrics,
  childResults: S.Array(
    S.suspend((): S.Codec<Report.MetricsResult, Report.MetricsResultEncoded> => MetricsResultFromReport),
  ),
}) {}
