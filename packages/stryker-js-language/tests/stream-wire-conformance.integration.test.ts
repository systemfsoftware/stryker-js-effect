import { expect } from 'vitest'

import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  FormatRegistryResolved,
  PluginsReported,
  RunEvent,
  RunFailed,
  SkippedReported,
  toWireLine,
} from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'

const checkExpect = expect

const Feature = makeFeature({ it, layer })

const PLUGIN_REPORT = PluginsReported.make({
  descriptors: [
    {
      moduleName: '@systemfsoftware/stryker-js-svelte',
      outcome: 'loaded',
      contributions: [{ kind: 'Framework', name: 'svelte' }],
    },
  ],
  shadowings: [],
})

const REGISTRY_REPORT = FormatRegistryResolved.make({
  rows: [{ extension: '.svelte', formatId: 'svelte', ownerModule: '@systemfsoftware/stryker-js-svelte' }],
})

const SKIP_REASON =
  'No installed format claims ".svelte". Install the framework plugin that claims this file type to instrument it.'

const SKIP_REPORT = SkippedReported.make({
  files: [{ file: 'src/app.svelte', extension: '.svelte', reason: SKIP_REASON }],
})

const FAILURE_REPORT = RunFailed.make({
  schemaVersion: '1.1',
  code: 4,
  error: 'Failed to load plugin "@systemfsoftware/stryker-js-broken" (ImportFailed)',
  remediation: 'fix the plugin so that it imports cleanly',
  reason: 'ImportFailed',
})

const PLUGIN_LINE =
  '{"kind":"plugins","descriptors":[{"moduleName":"@systemfsoftware/stryker-js-svelte","outcome":"loaded","contributions":[{"kind":"Framework","name":"svelte"}]}],"shadowings":[]}'
const REGISTRY_LINE =
  '{"kind":"formats","rows":[{"extension":".svelte","formatId":"svelte","ownerModule":"@systemfsoftware/stryker-js-svelte"}]}'
const SKIP_LINE =
  '{"kind":"skipped","files":[{"file":"src/app.svelte","extension":".svelte","reason":"No installed format claims \\".svelte\\". Install the framework plugin that claims this file type to instrument it."}]}'
const FAILURE_LINE =
  '{"kind":"error","schemaVersion":"1.1","code":4,"error":"Failed to load plugin \\"@systemfsoftware/stryker-js-broken\\" (ImportFailed)","remediation":"fix the plugin so that it imports cleanly","reason":"ImportFailed"}'

const REPORTS: readonly RunEvent[] = [PLUGIN_REPORT, REGISTRY_REPORT, SKIP_REPORT, FAILURE_REPORT]

Feature('Encoding the plugin, format, skip, and failure reports on the wire').body(({ scenario }) => {
  scenario(
    'Each report event encodes as its own machine wire line',
    Gherkin.Do.pipe(
      Given(
        'a plugin load, a resolved registry, a set of skipped files, and a refused plugin',
      )('events', () => Effect.succeed(REPORTS)),
      When('each event is encoded for the wire')(
        'lines',
        ({ events }: { events: readonly RunEvent[] }) => Effect.succeed(events.map(toWireLine)),
      ),
      Then('each wire line is the pinned machine encoding')(({ lines }: { lines: readonly string[] }) =>
        Effect.sync(() => {
          checkExpect(lines).toStrictEqual([PLUGIN_LINE, REGISTRY_LINE, SKIP_LINE, FAILURE_LINE])
        })
      ),
    ),
  )
})
