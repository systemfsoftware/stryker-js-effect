import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const decodeIncremental = (
  input: { readonly incremental?: boolean; readonly force?: boolean },
): { readonly incremental: boolean; readonly incrementalFile: string } | string => {
  const decoded = S.decodeResult(Options.StrykerOptionsSchema)(input)
  return Result.isSuccess(decoded)
    ? { incremental: decoded.success.incremental, incrementalFile: decoded.success.incrementalFile }
    : `refused: ${decoded.failure.message}`
}

Feature('Mutation testing is incremental by default')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'An empty configuration opts in, an explicit opt-out stays off, and the default file is named',
      Gherkin.Do.pipe(
        Given('an empty config, an incremental opt-out and a forced run')('probes', () =>
          Effect.sync(() => ({
            empty: {},
            optedOut: { incremental: false },
            forced: { incremental: true, force: true },
          }))),
        When('each configuration is decoded through the options schema')(
          'decoded',
          (s) =>
            Effect.sync(() =>
              Object.fromEntries(Object.entries(s.probes).map(([name, probe]) => [name, decodeIncremental(probe)]))
            ),
        ),
        Then('the empty config re-uses verdicts and the opt-out does not')((s, expect) =>
          expect(s.decoded).toEqual({
            empty: { incremental: true, incrementalFile: 'reports/stryker-incremental.json' },
            optedOut: { incremental: false, incrementalFile: 'reports/stryker-incremental.json' },
            forced: { incremental: true, incrementalFile: 'reports/stryker-incremental.json' },
          })
        ),
      ),
    )
  })
