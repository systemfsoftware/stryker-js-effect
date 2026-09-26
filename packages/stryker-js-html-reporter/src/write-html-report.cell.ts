import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
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

const buildReportHtml = (report: Reporter.MutationTestReportReady['report'], scriptContent: string) =>
  `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <script>
      ${scriptContent}
    </script>
  </head>
  <body>
    <svg style="width: 80px; position:fixed; right:10px; bottom:10px; z-index:10" class="stryker-image" viewBox="0 0 1458 1458" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2"><path fill="none" d="M0 0h1458v1458H0z"/><clipPath id="a"><path d="M0 0h1458v1458H0z"/></clipPath><g clip-path="url(#a)"><path d="M1458 729c0 402.655-326.345 729-729 729S0 1131.655 0 729C0 326.445 326.345 0 729 0s729 326.345 729 729" fill="#e74c3c" fill-rule="nonzero"/><path d="M778.349 1456.15L576.6 1254.401l233-105 85-78.668v-64.332l-257-257-44-187-50-208 251.806-82.793L1076.6 389.401l380.14 379.15c-19.681 367.728-311.914 663.049-678.391 687.599z" fill-opacity=".3"/><path d="M753.4 329.503c41.79 0 74.579 7.83 97.925 25.444 23.571 18.015 41.69 43.956 55.167 77.097l11.662 28.679 165.733-58.183-14.137-32.13c-26.688-60.655-64.896-108.61-114.191-144.011-49.329-35.423-117.458-54.302-204.859-54.302-50.78 0-95.646 7.376-134.767 21.542-40.093 14.671-74.09 34.79-102.239 60.259-28.84 26.207-50.646 57.06-65.496 92.701-14.718 35.052-22.101 72.538-22.101 112.401 0 72.536 20.667 133.294 61.165 182.704 38.624 47.255 98.346 88.037 179.861 121.291 42.257 17.475 78.715 33.125 109.227 46.994 27.193 12.361 49.294 26.124 66.157 41.751 15.309 14.186 26.497 30.584 33.63 49.258 7.721 20.214 11.16 45.69 11.16 76.402 0 28.021-4.251 51.787-13.591 71.219-8.832 18.374-20.171 33.178-34.523 44.219-14.787 11.374-31.193 19.591-49.393 24.466-19.68 5.359-39.14 7.993-58.69 7.993-29.359 0-54.387-3.407-75.182-10.747-20.112-7.013-37.144-16.144-51.259-27.486-13.618-11.009-24.971-23.766-33.744-38.279-9.64-15.8-17.272-31.924-23.032-48.408l-10.965-31.376-161.669 60.585 10.734 30.124c10.191 28.601 24.197 56.228 42.059 82.748 18.208 27.144 41.322 51.369 69.525 72.745 27.695 21.075 60.904 38.218 99.481 51.041 37.777 12.664 82.004 19.159 132.552 19.159 49.998 0 95.818-8.321 137.611-24.622 42.228-16.471 78.436-38.992 108.835-67.291 30.719-28.597 54.631-62.103 71.834-100.642 17.263-38.56 25.923-79.392 25.923-122.248 0-54.339-8.368-100.37-24.208-138.32-16.29-38.759-38.252-71.661-65.948-98.797-26.965-26.418-58.269-48.835-93.858-67.175-33.655-17.241-69.196-33.11-106.593-47.533-35.934-13.429-65.822-26.601-89.948-39.525-22.153-11.868-40.009-24.21-53.547-37.309-11.429-11.13-19.83-23.678-24.718-37.664-5.413-15.49-7.98-33.423-7.98-53.577 0-40.883 11.293-71.522 37.086-90.539 28.443-20.825 64.985-30.658 109.311-30.658z" fill="#f1c40f" fill-rule="nonzero"/><path d="M720 0h18v113h-18zM1458 738v-18h-113v18h113zM720 1345h18v113h-18zM113 738v-18H0v18h113z"/></g></svg>
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

const readBundleFromDisk = Effect.fn('html_report.read_bundle_from_disk')(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const bundlePath = yield* path.fromFileUrl(new URL(import.meta.resolve(BUNDLE_SPECIFIER)))
  return yield* fs.readFileString(bundlePath)
})

const writeHtmlFile = Effect.fn('html_report.write_file')(function*(fileName: string, html: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.dirname(fileName), { recursive: true })
  yield* fs.writeFileString(fileName, html)
})

export type RenderHtmlReportRead = (typeof RenderHtmlReport)['Encoded'] & {
  readonly report: Reporter.MutationTestReportReady['report']
}

const readRenderCommand = (input: {
  readonly fileName: string
  readonly report: Reporter.MutationTestReportReady['report']
  readonly inlinedBundle: string | undefined
}): Effect.Effect<RenderHtmlReportRead> =>
  Effect.succeed({
    _tag: 'RenderHtmlReport',
    fileName: input.fileName,
    inlinedBundle: input.inlinedBundle,
    report: input.report,
  })

const writeBundleFromDisk = Effect.fn('html_report.write_bundle_from_disk')(function*(command: RenderHtmlReportRead) {
  const bundle = yield* readBundleFromDisk()
  yield* writeHtmlFile(command.fileName, buildReportHtml(command.report, bundle))
})

export const writeHtmlReport = Sandwich.named('html_report.write')(readRenderCommand)
  .decide(renderHtmlReport)
  .write({
    BundleInlined: ({ bundle }, command) => writeHtmlFile(command.fileName, buildReportHtml(command.report, bundle)),
    BundleFromDisk: (_decision, command) => writeBundleFromDisk(command),
    CommandRejected: (rejected) => Effect.die(rejected),
  })

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const failAsHtmlReporter = <A = unknown>(cause: A) =>
  Reporter.ReporterFailed.make({
    reporterName: 'html',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
  })

const drainEvents = (fileName: string, events: AsyncIterable<Reporter.ReporterEvent>) =>
  Stream.runForEach(
    Stream.fromAsyncIterable(events, failAsHtmlReporter).pipe(Stream.filter(S.is(Reporter.MutationTestReportReady))),
    (ready) =>
      writeHtmlReport.run({ fileName, report: ready.report, inlinedBundle: inlinedBundle() }).pipe(
        Effect.mapError(failAsHtmlReporter),
      ),
  )

export const makeHtmlReporter = dual<
  (
    options: Options.StrykerOptions,
  ) => (
    init: Reporter.ReporterInit,
  ) => (events: AsyncIterable<Reporter.ReporterEvent>) => Effect.Effect<void, Reporter.ReporterFailed>,
  (
    options: Options.StrykerOptions,
    init: Reporter.ReporterInit,
  ) => (events: AsyncIterable<Reporter.ReporterEvent>) => Effect.Effect<void, Reporter.ReporterFailed>
>(
  2,
  (options, _init) => (events) =>
    Layer.build(nodeFsPathLayer).pipe(
      Effect.flatMap((platform) => Effect.provideContext(drainEvents(options.htmlReporter.fileName, events), platform)),
      Effect.scoped,
    ),
)
