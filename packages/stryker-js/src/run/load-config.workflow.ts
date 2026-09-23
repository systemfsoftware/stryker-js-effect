import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PartialStrykerOptionsSchema, StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '../config/merge-config.js'
import {
  ConfigFromDefaults,
  ConfigFromFile,
  type LoadConfigDecision,
  LoadConfigRefused,
} from '../Config.schema.js'
import { configErrorMessage, describeErrors } from './load-config-errors.js'

export class LoadConfigCommand extends S.TaggedClass<LoadConfigCommand>()('LoadConfigCommand', {
  cliOptions: PartialStrykerOptionsSchema,
  fileOptions: S.optional(PartialStrykerOptionsSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export const resolveConfig = Workflow.make({
  command: LoadConfigCommand,
  decision: S.Union([ConfigFromFile, ConfigFromDefaults]),
  error: LoadConfigRefused,
  decide: (command) =>
    Result.map(
      S.decodeUnknownResult(StrykerOptionsSchema)(
        mergeConfig(Option.getOrUndefined(command.fileOptions) ?? {}, command.cliOptions),
      ),
      { onError: (failure) => LoadConfigRefused.make({ message: failure.pipe(describeErrors, configErrorMessage) }) },
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
