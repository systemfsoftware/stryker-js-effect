import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { StageError } from '@systemfsoftware/stryker-js-engine'
import type { PluginLoadFailedError } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { resolveExitCode } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'

import { loadFixture, REFUSAL_ROWS } from './__fixtures__/loader-support.js'

const CODE_OF: Record<string, number> = { ConfigError: 2, InternalError: 4 }

const Feature = makeFeature({ it, layer })

Feature('Refusing a plugin the loader cannot accept').body(({ scenarioOutline }) => {
  scenarioOutline(
    'A module with <label> is refused with the exit class its reason decides',
    REFUSAL_ROWS,
    (row) =>
      Gherkin.Do.pipe(
        Given('a plugin module the loader cannot accept')('name', () => Effect.succeed(row.fixture)),
        When('the loader refuses it')('error', (s: { name: string }) => loadFixture(s.name).pipe(Effect.flip)),
        Then('the refusal names its reason, the prepare stage keeps that class, and the run exits with it')((s: {
          error: PluginLoadFailedError
        }) => {
          expect(s.error.reason._tag).toBe(row.reason)
          const stage = new StageError({ stage: 'prepare', reason: 'Failed to load plugins', cause: s.error })
          expect(stage.exitClass).toBe(row.exitClass)
          expect(resolveExitCode([stage.exitClass], null)).toBe(CODE_OF[row.exitClass])
        }),
      ),
  )
})
