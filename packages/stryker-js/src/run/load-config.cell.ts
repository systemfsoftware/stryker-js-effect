import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'

import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { describedConfigErrorOf, emitPreparePhaseEntered, failConfigWith, readLoadConfig } from './load-config.js'
import { resolveConfig } from './resolve-config.workflow.js'
import { RunEnvironment } from './RunEnvironment.service.js'

export type { ConfigInvocation, LoadedConfig } from './load-config.js'
export type { ConfigReadError } from './read-config-document.js'
export type { ValidationSchemaDocument } from './validate-options-admission.workflow.js'

const readRunConfig = Effect.fn(SpanTaxonomy.Spans.configReadRun.name)(function*(input: {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
}) {
  const env = yield* RunEnvironment
  const raw = yield* readLoadConfig({
    cliOptions: input.cliOptions,
    invocation: { command: 'run', mode: env.resolvedMode.mode },
  }).pipe(Effect.tapCause(() => emitPreparePhaseEntered))
  return {
    ...raw,
    targetMutatePatterns: input.targetMutatePatterns,
    basePath: env.basePath,
  }
})

export const loadConfigCell = Sandwich.named(SpanTaxonomy.Spans.loadConfig.name)(readRunConfig)
  .decide(resolveConfig)
  .write({
    ConfigFromFile: ({ options }, raw) =>
      Effect.succeed({
        options,
        targetMutatePatterns: raw.targetMutatePatterns,
        basePath: raw.basePath,
      }),
    ConfigFromDefaults: ({ options }, raw) =>
      Effect.succeed({
        options,
        targetMutatePatterns: raw.targetMutatePatterns,
        basePath: raw.basePath,
      }),
    ConfigOptionsRefused: ({ message }) => failConfigWith(describedConfigErrorOf({ message }).text),
    CommandRejected: ({ issue }) => failConfigWith(issue),
  })
