import { MetricsResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { MutationTestResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
export class ClearTextReportCommand extends S.TaggedClass<ClearTextReportCommand>()('ClearTextReportCommand', {
  report: MutationTestResultSchema,
  metrics: MetricsResultSchema,
}) {}
