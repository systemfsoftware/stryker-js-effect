import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { MutationTestReportReady } from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent, ReporterInit, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { RenderHtmlReport, renderHtmlReport } from './render-html-report.workflow.js'

const escapeHtmlTags = (json: string) => json.replace(/</g, '<"+"')

const buildReportHtml = (report: MutationTestReportReady['report'], scriptContent: string) =>
  `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <script>
      ${scriptContent}
    </script>
  </head>
  <body>
    <svg style="width: 80px; position:fixed; right:10px; bottom:10px; z-index:10" class="stryker-image" viewBox="0 0 1458 1458" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2"><path fill="none" d="M0 0h1458v1458H0z"/><clipPath id="a"><path d="M0 0h1458v1458H0z"/></clipPath><g clip-path="url(#a)"><path d="M1458 729c0 402.655-326.345 729-729 729S0 1131.655 0 729C0 326.445 326.345 0 729 0s729 326.345 729 729" fill="#e74c3c" fill-rule="nonzero"/><path d="M778.349 1456.15L576.6 1254.401l233-105 85-78.668v-64.332l-257-257-44-187-50-208 251.806-82.793L1076.6 389.401l380.14 379.15c-19.681 367.728-311.914 663.049-678.391 687.599z" fill-opacity=".3"/><path d="M753.4 329.503c41.79 0 74.579 7.83 97…</path></g></svg>
    <mutation-test-report-app titlePostfix="Stryker">
      Your browser doesn't support <a href="https://caniuse.com/#search=custom%20elements">custom elements</a>.
      Please use a latest version of an evergreen browser (Firefox, Chrome, Safari, Opera, Edge, etc).
    </mutation-test-report-app>
    <script>
      const app = document.querySelector('mutation-test-report-app');
      app.report = ${escapeHtmlTags(JSON.stringify(report))};
      function updateTheme() {
        document.body.style.backgroundColor = app.themeBackgroundColor;
      }
      app.addEventListener('theme-changed', updateTheme);
      updateTheme();
    </script>
  </body>
  </html>`

const BUNDLE_SPECIFIER = 'mutation-testing-elements/dist/mutation-test-elements.js'

/**
 * The client bundle, when the build inlined it. A build that ships this
 * reporter bundled — with no `mutation-testing-elements` on disk to resolve
 * against — bakes the text here; a build that leaves the package resolvable
 * reads it at runtime instead.
 */
declare const __STRYKER_HTML_REPORTER_CLIENT_BUNDLE__: string | undefined

const inlinedBundle = () =>
  Match.value(typeof __STRYKER_HTML_REPORTER_CLIENT_BUNDLE__).pipe(
    Match.when('undefined', () => undefined),
    Match.orElse(() => __STRYKER_HTML_REPORTER_CLIENT_BUNDLE__),
  )

const readBundleFromDisk = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const bundlePath = yield* path.fromFileUrl(new URL(import.meta.resolve(BUNDLE_SPECIFIER)))
  return yield* fs.readFileString(bundlePath)
})

const writeHtmlFile = (fileName: string, html: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(path.dirname(fileName), { recursive: true })
    yield* fs.writeFileString(fileName, html)
  })

export type RenderHtmlReportRead = (typeof RenderHtmlReport)['Encoded'] & {
  readonly report: MutationTestReportReady['report']
}

const readRenderCommand = (input: {
  readonly fileName: string
  readonly report: MutationTestReportReady['report']
}): Effect.Effect<RenderHtmlReportRead> =>
  Effect.succeed({
    _tag: 'RenderHtmlReport',
    fileName: input.fileName,
    inlinedBundle: inlinedBundle(),
    report: input.report,
  })

export const writeHtmlReport = Sandwich.named('html_report.write')(readRenderCommand)
  .decide(renderHtmlReport)
  .write({
    BundleInlined: ({ bundle }, command) => writeHtmlFile(command.fileName, buildReportHtml(command.report, bundle)),
    BundleFromDisk: (_decision, command) =>
      Effect.gen(function*() {
        const bundle = yield* readBundleFromDisk
        yield* writeHtmlFile(command.fileName, buildReportHtml(command.report, bundle))
      }),
    CommandRejected: (rejected) => Effect.die(rejected),
  })

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const failAsHtmlReporter = <A = unknown>(cause: A) =>
  ReporterFailed.make({
    reporterName: 'html',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
  })

const drainEvents = (fileName: string, events: AsyncIterable<ReporterEvent>) =>
  Stream.runForEach(
    Stream.fromAsyncIterable(events, failAsHtmlReporter).pipe(Stream.filter(S.is(MutationTestReportReady))),
    (ready) => writeHtmlReport.run({ fileName, report: ready.report }).pipe(Effect.mapError(failAsHtmlReporter)),
  )

export const makeHtmlReporter = dual<
  (
    options: StrykerOptions,
  ) => (init: ReporterInit) => (events: AsyncIterable<ReporterEvent>) => Effect.Effect<void, ReporterFailed>,
  (
    options: StrykerOptions,
    init: ReporterInit,
  ) => (events: AsyncIterable<ReporterEvent>) => Effect.Effect<void, ReporterFailed>
>(
  2,
  (options, _init) => (events) =>
    Layer.build(nodeFsPathLayer).pipe(
      Effect.flatMap((platform) => Effect.provideContext(drainEvents(options.htmlReporter.fileName, events), platform)),
      Effect.scoped,
    ),
)
