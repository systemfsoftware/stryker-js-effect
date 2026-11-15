import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import { Contract, ObservationWindow, Rel, Stimulus, Suite } from '@systemfsoftware/trace-spec'
import { Span, Taxonomy } from '@systemfsoftware/trace-taxonomy'
import { it } from '@systemfsoftware/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { metricsFixture, optionsWith, reportFixture, runEvents, toStream } from './__fixtures__/run-events.fixture.js'

const TraceSuite = Suite.make({ it })

const HtmlReportWrite = Span.declare({
  id: SpanTaxonomy.Spans.htmlReportWrite.name,
  name: SpanTaxonomy.Spans.htmlReportWrite.name,
  attrs: S.Struct(SpanTaxonomy.Spans.htmlReportWrite.attributes),
})

const HtmlReporterTaxonomy = Taxonomy.make('stryker-js-html-reporter').pipe(Taxonomy.add(HtmlReportWrite))

const REPORT_FILE = 'report.html'

const writeReportInto = (directory: string) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const options = yield* optionsWith(path.join(directory, REPORT_FILE))
    yield* HtmlReporter.makeHtmlReporter(options, {})(
      toStream(runEvents({ report: reportFixture(), metrics: metricsFixture() })),
    )
  })

const writeReport = Stimulus.make({
  name: 'html_report.write_report',
  run: ({ input }: { readonly input: string }) =>
    Effect.acquireUseRelease(
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeDirectory(input, { recursive: true })),
      () => writeReportInto(input),
      () => Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(input, { recursive: true, force: true })),
    ).pipe(Effect.orDie),
})

const directoryUnderTest = decodeURIComponent(
  new URL(`../artifacts/html-report-write-${crypto.randomUUID()}`, import.meta.url).pathname,
)

const writeTracedWithItsFile = Contract.of(HtmlReporterTaxonomy)
  .stimulate(writeReport)
  .holds(Rel.all(
    Rel.unique(HtmlReportWrite),
    Rel.attrs(HtmlReportWrite, { 'stryker.html_report.file_name': `${directoryUnderTest}/${REPORT_FILE}` }),
  ))

const harness = Layer.mergeAll(
  ObservationWindow.make('stryker-js-html-reporter').layer,
  NodeFileSystem.layer,
  NodePath.layer,
)

TraceSuite('html_report.write')
  .withScenarioLayer(harness)
  .live('the reporter writes a real file to disk')
  .body(({ Case }) => {
    Case('one write span names the file the report is written to', writeTracedWithItsFile, directoryUnderTest)
  })
