import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class RunExitCode extends S.Class<RunExitCode>('RunExitCode')({
  code: Plugin.ExitCode,
}) {}
