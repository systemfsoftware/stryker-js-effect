import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '../config/merge-config.js'
import {
  ConfigFromDefaults,
  ConfigFromFile,
  type LoadConfigDecision,
  LoadConfigRefused,
} from '../Config.schema.js'
import { configErrorMessage, describeErrors } from './load-config.cell.js'

export class LoadConfigCommand extends S.TaggedClass<LoadConfigCommand>()('LoadConfigCommand', {
  cliOptions: S.Record(S.String, S.Unknown),
  fileOptions: S.optional(S.Record(S.String, S.Unknown)),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export const resolveConfig = Workflow.make({
  command: LoadConfigCommand,
  decision: S.Union([ConfigFromFile, ConfigFromDefaults]),
  error: LoadConfigRefused,
  decide: (command) =>
    Result.mapError(
      S.decodeUnknownResult(StrykerOptionsSchema)(
        mergeConfig(Option.getOrElse(command.fileOptions, () => ({})), command.cliOptions),
      ),
      (failure) => LoadConfigRefused.make({ message: failure.pipe(describeErrors, configErrorMessage) }),
    ).pipe(
      Result.flatMap((options) =>
        Result.succeed(
          Option.match(command.fileOptions, {
            onNone: () => ConfigFromDefaults.make({ options }),
            onSome: () => ConfigFromFile.make({ options }),
          }),
        ),
      ),
    ),
})

export type { LoadConfigDecision }
