import { MetricsResultSchema } from '@systemfsoftware/stryker-js-language'
import { MutationTestResultSchema } from '@systemfsoftware/stryker-js-language'
import * as S from 'effect/Schema'
export class ClearTextReportCommand extends S.TaggedClass<ClearTextReportCommand>()('ClearTextReportCommand', {
  report: MutationTestResultSchema,
  metrics: MetricsResultSchema,
}) {}
