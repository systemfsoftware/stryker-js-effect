import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { FrameworkContext, Program } from '@systemfsoftware/stryker-framework-interface'
import { FrameworkFailed } from '@systemfsoftware/stryker-js-language'
import type { EmbeddedDocument } from '@systemfsoftware/stryker-js-language'
import type { PluginEnvironment } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import { expect } from 'vitest'

import type { SvelteServiceOutcome } from './__fixtures__/svelte-plugin.js'
import {
  belowRangePeers,
  fixturePeers,
  installedEnvironmentLayer,
  interopPeers,
  interopShapelessPeers,
  missingPeers,
  peerEnvironmentLayer,
  peerFloor,
  serviceOutcome,
  shapelessPeers,
  strangerPeers,
  svelteDevPin,
  sveltePeerRange,
  walkerlessPeers,
} from './__fixtures__/svelte-plugin.js'

const SANDBOX = '/tmp/svelte-project'

const COMPONENT = `<script>
  export let n = 1
  const big = n > 10
</script>
<p>{big}</p>
`

const [FLOOR_MAJOR, FLOOR_MINOR] = peerFloor(sveltePeerRange)
const BELOW_SUPPORTED = `${FLOOR_MAJOR}.${FLOOR_MINOR - 1}.0`
const FLOOR_VERSION = `${FLOOR_MAJOR}.${FLOOR_MINOR}.0`
const INTEROP_VERSION = '5.0.0'

const SCRIPT_OPEN = '<script>'
const SCRIPT_CLOSE = '</script>'
const MUSTACHE = '{big}'

const scriptStart = COMPONENT.indexOf(SCRIPT_OPEN) + SCRIPT_OPEN.length
const scriptEnd = COMPONENT.indexOf(SCRIPT_CLOSE)
const expressionStart = COMPONENT.indexOf(MUSTACHE) + 1
const expressionEnd = expressionStart + 'big'.length

const EXPECTED_SPANS: readonly string[] = [`${scriptStart}-${scriptEnd}`, `${expressionStart}-${expressionEnd}`]

const ACCEPTED_ROWS = [
  {
    label: 'the oldest supported version',
    environment: (): Effect.Effect<Layer.Layer<PluginEnvironment>> =>
      Effect.succeed(peerEnvironmentLayer(SANDBOX, fixturePeers())),
    ownerVersion: FLOOR_VERSION,
  },
  {
    label: 'the compiler this package installs',
    environment: (): Effect.Effect<Layer.Layer<PluginEnvironment>> => installedEnvironmentLayer,
    ownerVersion: svelteDevPin,
  },
  {
    label: 'an interop-wrapped compiler',
    environment: (): Effect.Effect<Layer.Layer<PluginEnvironment>> =>
      Effect.succeed(peerEnvironmentLayer(SANDBOX, interopPeers())),
    ownerVersion: INTEROP_VERSION,
  },
] as const satisfies readonly Record<string, unknown>[]

const REFUSED_ROWS = [
  {
    label: 'a version below the supported range',
    peers: belowRangePeers(),
    refusal: `PeerVersionUnsupported: svelte ${BELOW_SUPPORTED} is not supported (expected ${sveltePeerRange})`,
    peer: 'svelte',
    version: BELOW_SUPPORTED,
    supportedRange: sveltePeerRange,
  },
  {
    label: 'no compiler installed',
    peers: missingPeers(),
    refusal: 'PeerMissing: the "svelte" peer is not installed',
    peer: 'svelte',
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'a module that is not a compiler',
    peers: strangerPeers(),
    refusal: 'InvalidContribution: "svelte/compiler" must export VERSION, parse, and preprocess',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'a walker without a walk',
    peers: walkerlessPeers(),
    refusal: 'InvalidContribution: "oxc-walker" must export walk',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'a module exporting none of the compiler fields',
    peers: shapelessPeers(),
    refusal: 'InvalidContribution: "svelte/compiler" must export VERSION, parse, and preprocess',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'an interop-wrapped module exporting none of the compiler fields',
    peers: interopShapelessPeers(),
    refusal: 'InvalidContribution: "svelte/compiler" must export VERSION, parse, and preprocess',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
] as const satisfies readonly Record<string, unknown>[]

const scriptProgram = (): Program => ({ type: 'Program', sourceType: 'module', body: [], hashbang: null })

const toolkit = (): FrameworkContext => ({
  parseScript: () => scriptProgram(),
  transformScript: (script) => script,
  printScript: () => '',
  instrumentationHeader: () => [],
})

const refusalOf = (outcome: SvelteServiceOutcome): string =>
  Match.value(outcome.failure).pipe(
    Match.when(Predicate.isNotNullish, (failure) => `${failure.reason}: ${String(failure.cause)}`),
    Match.orElse(() => 'no refusal'),
  )

const refusalFieldsOf = (outcome: SvelteServiceOutcome) => ({
  peer: outcome.failure?.peer,
  version: outcome.failure?.version,
  supportedRange: outcome.failure?.supportedRange,
})

const preparedService = (outcome: SvelteServiceOutcome) => {
  if (outcome.service === undefined) {
    throw new Error(`the plugin prepared no format: ${refusalOf(outcome)}`)
  }
  return outcome.service
}

const regionSpansOf = (parsed: Exit.Exit<EmbeddedDocument, FrameworkFailed>): readonly string[] =>
  Match.value(parsed).pipe(
    Match.when(Exit.isSuccess, (success) => success.value.regions.map((region) => `${region.start}-${region.end}`)),
    Match.orElse(() => []),
  )

const servedAgainst = (environment: Layer.Layer<PluginEnvironment>) =>
  Effect.gen(function*() {
    const outcome = yield* serviceOutcome(environment)
    const parsed = yield* Effect.exit(preparedService(outcome).parse(COMPONENT, toolkit()))
    return { outcome, parsed }
  })

const Feature = makeFeature({ it, layer })

Feature('Preparing the svelte compiler for a mutation run').body(({ scenarioOutline }) => {
  scenarioOutline(
    'A compiler of <label> is accepted and walks the template it was resolved for',
    ACCEPTED_ROWS,
    (row) =>
      Gherkin.Do.pipe(
        Given('a project whose svelte compiler is <label>')(
          'environment',
          () => row.environment(),
        ),
        When('the plugin prepares for a run and reads a component')(
          'served',
          (s) => servedAgainst(s.environment),
        ),
        Then('the component is read and its document carries the template the chosen walker reported')((s) => {
          expect(refusalOf(s.served.outcome)).toBe('no refusal')
          expect(preparedService(s.served.outcome).claim.ownerVersion).toBe(row.ownerVersion)
          expect(regionSpansOf(s.served.parsed)).toStrictEqual(EXPECTED_SPANS)
        }),
      ),
  )

  scenarioOutline(
    'A svelte peer that is <label> refuses the run before it reads a component',
    REFUSED_ROWS,
    (row) =>
      Gherkin.Do.pipe(
        Given('a project whose svelte peer is <label>')(
          'environment',
          () => Effect.succeed(peerEnvironmentLayer(SANDBOX, row.peers)),
        ),
        When('the plugin prepares for a run')('outcome', (s) => serviceOutcome(s.environment)),
        Then('the run is refused and the refusal names what the project has to fix')((s) => {
          expect(s.outcome.service).toBeUndefined()
          expect(refusalOf(s.outcome)).toBe(row.refusal)
          expect(refusalFieldsOf(s.outcome)).toStrictEqual({
            peer: row.peer,
            version: row.version,
            supportedRange: row.supportedRange,
          })
        }),
      ),
  )
})
