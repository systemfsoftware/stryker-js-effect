import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Configuration } from '@systemfsoftware/stryker-js-contracts'
import * as Effect from 'effect/Effect'
import { describedConfigErrorOf } from './load-config.js'
import { validateOptionsAdmission, ValidateOptionsCommand } from './validate-options-admission.workflow.js'

const readValidateOptions = (command: ValidateOptionsCommand) => Effect.succeed(command)

export const validateOptionsCell = Sandwich.named(SpanTaxonomy.Spans.validateOptions.name)(readValidateOptions)
  .decide(validateOptionsAdmission)
  .write({
    OptionsValidated: ({ options, warnings }) =>
      Effect.forEach(warnings, (warning) => Effect.logWarning(warning), { discard: true }).pipe(Effect.as(options)),
    OptionsRefused: ({ errors, warnings }) =>
      Effect.forEach(warnings, (warning) => Effect.logWarning(warning), { discard: true }).pipe(
        Effect.flatMap(() => Effect.forEach(errors, (error) => Effect.logError(error), { discard: true })),
        Effect.flatMap(() =>
          Effect.fail(Configuration.ConfigError.make({ message: describedConfigErrorOf({ errors }).text }))
        ),
      ),
    OptionsUndecodable: ({ message, warnings }) => {
      const described = describedConfigErrorOf({ message })
      return Effect.forEach(warnings, (warning) => Effect.logWarning(warning), { discard: true }).pipe(
        Effect.flatMap(() => Effect.forEach(described.errors, (error) => Effect.logError(error), { discard: true })),
        Effect.flatMap(() => Effect.fail(Configuration.ConfigError.make({ message: described.text }))),
      )
    },
    CommandRejected: ({ issue }) => Effect.fail(Configuration.ConfigError.make({ message: issue })),
  })
