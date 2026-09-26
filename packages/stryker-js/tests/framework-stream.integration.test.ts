import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const CORE_OWNER = '@systemfsoftware/stryker-js-instrumenter'
const SVELTE_MODULE = '@systemfsoftware/stryker-js-svelte'

const frameworkModule = 'file:///project/node_modules/@acme/framework/index.mjs'
const firstModule = 'file:///project/node_modules/@acme/first/index.mjs'
const secondModule = 'file:///project/node_modules/@acme/second/index.mjs'

const loadReport = RunEvent.PluginsReported.make({
  modules: [
    {
      moduleName: frameworkModule,
      contributions: [{ name: 'fixture-format', formatId: 'fixture', extensions: ['.fixture'] }],
    },
  ],
  shadowings: [{ extension: '.html', winner: firstModule, loser: secondModule }],
})

const registryRows: ReadonlyArray<RunEvent.FormatRegistryRow> = [
  { extension: '.ts', formatId: 'ts', ownerModule: CORE_OWNER, language: 'typescript' },
  { extension: '.fixture', formatId: 'fixture', ownerModule: frameworkModule, language: 'fixture' },
]

const registryReport = RunEvent.FormatRegistryResolved.make({ rows: [...registryRows] })

const svelteReason =
  `No loaded framework claims ".svelte". Install ${SVELTE_MODULE} and add it to "plugins" to instrument it.`
const genericReason =
  'No loaded framework claims ".txt". Install the framework plugin that claims this file type to instrument it.'

const skippedReport = RunEvent.SkippedReported.make({
  files: [
    { file: 'src/component.svelte', extension: '.svelte', reason: svelteReason },
    { file: 'src/widget.txt', extension: '.txt', reason: genericReason },
  ],
})

const refusal = RunEvent.RunFailed.make({
  schemaVersion: '1.1',
  code: 2,
  error: `Failed to load plugin "${frameworkModule}" (PeerMissing)`,
  remediation: 'install the peer dependency the plugin needs',
  reason: { _tag: 'PeerMissing', peer: frameworkModule },
})

type ReportEvent =
  | RunEvent.PluginsReported
  | RunEvent.FormatRegistryResolved
  | RunEvent.SkippedReported
  | RunEvent.RunFailed

const wireOf = (event: ReportEvent): Effect.Effect<string, never> =>
  S.encodeEffect(RunEvent.RunEventWireLine)(event).pipe(
    Effect.map((encoded) => {
      if (typeof encoded !== 'string') {
        throw new Error('the wire line was expected to encode to a string')
      }
      return encoded
    }),
    Effect.orDie,
  )

const wireAll = (events: ReadonlyArray<ReportEvent>): Effect.Effect<ReadonlyArray<string>, S.SchemaError> =>
  Effect.forEach(events, wireOf)

const decodedOf = (line: string): Effect.Effect<RunEvent.RunFailed, S.SchemaError> =>
  S.decodeEffect(RunEvent.RunEventWireLine)(line).pipe(
    Effect.filterOrElse(
      (event): event is RunEvent.RunFailed => S.is(RunEvent.RunFailed)(event),
      () => Effect.die(new Error('the decoded line was expected to be a failure event')),
    ),
  )

Feature('Reporting framework plugins on the machine wire')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A machine reader sees loaded contributions, the registry, and skipped files verbatim',
      Gherkin.Do.pipe(
        Given('the three framework report events')(
          'lines',
          () => wireAll([loadReport, registryReport, skippedReport]),
        ),
        When('the reader keeps the wire lines')(
          'seen',
          (s) => Effect.succeed(s.lines),
        ),
        Then('each line carries its tag, its rows, and a trailing newline')((s, expect) =>
          expect(s.seen).toEqual([
            `{"_tag":"plugins","modules":[{"moduleName":"${frameworkModule}","contributions":[{"name":"fixture-format","formatId":"fixture","extensions":[".fixture"]}]}],"shadowings":[{"extension":".html","winner":"${firstModule}","loser":"${secondModule}"}]}\n`,
            `{"_tag":"formats","rows":[{"extension":".ts","formatId":"ts","ownerModule":"${CORE_OWNER}","language":"typescript"},{"extension":".fixture","formatId":"fixture","ownerModule":"${frameworkModule}","language":"fixture"}]}\n`,
            `{"_tag":"skipped","files":[{"file":"src/component.svelte","extension":".svelte","reason":"No loaded framework claims \\".svelte\\". Install ${SVELTE_MODULE} and add it to \\"plugins\\" to instrument it."},{"file":"src/widget.txt","extension":".txt","reason":"No loaded framework claims \\".txt\\". Install the framework plugin that claims this file type to instrument it."}]}\n`,
          ])
        ),
      ),
    )

    scenario(
      'A refused load carries its typed reason on the failure event',
      Gherkin.Do.pipe(
        Given('a load refused for a missing peer')(
          'line',
          () => wireOf(refusal),
        ),
        When('the reader decodes the failure line')(
          'seen',
          (s) => decodedOf(s.line),
        ),
        Then('the failure names the reason, the configuration code, and the remedy')((s, expect) =>
          expect({ reason: s.seen.reason, code: s.seen.code, remediation: s.seen.remediation }).toEqual({
            reason: { _tag: 'PeerMissing', peer: frameworkModule },
            code: 2,
            remediation: 'install the peer dependency the plugin needs',
          })
        ),
      ),
    )

    scenario(
      'The skip explanation names the installer for a known framework extension',
      Gherkin.Do.pipe(
        Given('a skipped Svelte file and a skipped unknown file')(
          'files',
          () => Effect.succeed(skippedReport.files),
        ),
        When('the reader compares the two explanations')(
          'seen',
          (s) => Effect.succeed({ known: s.files[0]?.reason ?? '', unknown: s.files[1]?.reason ?? '' }),
        ),
        Then('the known extension names its package and the unknown one stays generic')((s, expect) =>
          expect(s.seen).toEqual({ known: svelteReason, unknown: genericReason })
        ),
      ),
    )
  })
