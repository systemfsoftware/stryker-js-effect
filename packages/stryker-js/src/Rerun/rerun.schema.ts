import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class RerunEngineUnusable extends S.TaggedClass<RerunEngineUnusable>()('RerunEngineUnusable', {
  code: Plugin.ExitCode,
  record: FailureRecord.FailureRecord,
}) {}
