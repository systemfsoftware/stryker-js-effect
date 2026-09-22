import { MutationTestResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class HtmlReportCommand extends S.TaggedClass<HtmlReportCommand>()('HtmlReportCommand', {
  report: MutationTestResultSchema,
  scriptContent: S.String,
}) {}

export class HtmlDocument extends S.TaggedClass<HtmlDocument>()('HtmlDocument', {
  html: S.String,
}) {}

export class HtmlReportError extends S.TaggedError<HtmlReportError>()('HtmlReportError', {
  message: S.String,
}) {}
