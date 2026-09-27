import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'

import { ConfigError } from '../ConfigError.schema.js'
import { ValidateOptionsCommand, type ValidationSchemaDocument } from './validate-options-admission.workflow.js'
import { validateOptionsCell } from './validate-options.cell.js'

export const validateOptions = dual<
  <A = unknown>(
    schema: ValidationSchemaDocument,
  ) => (options: Record<string, A>) => Effect.Effect<Options.StrykerOptions, ConfigError>,
  <A = unknown>(
    options: Record<string, A>,
    schema: ValidationSchemaDocument,
  ) => Effect.Effect<Options.StrykerOptions, ConfigError>
>(2, (options, schema) => validateOptionsCell.run(ValidateOptionsCommand.make({ options, schema })))
