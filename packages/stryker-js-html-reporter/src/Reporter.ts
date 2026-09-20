import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { errorToString } from '@systemfsoftware/stryker-js-instrumenter'
import { MutationTestReportReady } from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterFactory } from '@systemfsoftware/stryker-js-plugin-interface'
import { ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import type { BadArgument, PlatformError } from 'effect/PlatformError'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { HtmlDocument, HtmlReportCommand } from './Reporter.schema.js'

function escapeHtmlTags(json: string): string {
  return json.replace(/</g, '<"+"')
}

function buildReportHtml(report: unknown, scriptContent: string): string {
  return `<!DOCTYPE html>
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
}

export const buildHtmlDocument = (command: HtmlReportCommand): HtmlDocument =>
  HtmlDocument.make({ html: buildReportHtml(command.report, command.scriptContent) })

const BUNDLE_SPECIFIER = 'mutation-testing-elements/dist/mutation-test-elements.js'

/**
 * The client bundle, when the build inlined it. A build that ships this
 * reporter bundled — with no `mutation-testing-elements` on disk to resolve
 * against — bakes the text here; a build that leaves the package resolvable
 * reads it at runtime instead.
 */
declare const __STRYKER_HTML_REPORTER_CLIENT_BUNDLE__: string | undefined

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const inlinedBundle = (): string | undefined =>
  Match.value(typeof __STRYKER_HTML_REPORTER_CLIENT_BUNDLE__).pipe(
    Match.when('undefined', () => undefined),
    Match.orElse(() => __STRYKER_HTML_REPORTER_CLIENT_BUNDLE__),
  )

const readBundleContent: Effect.Effect<string, BadArgument | PlatformError, FileSystem.FileSystem | Path.Path> = Effect
  .suspend(() =>
    Match.value(inlinedBundle()).pipe(
      Match.when(Match.string, (bundle) => Effect.succeed(bundle)),
      Match.orElse(() =>
        Effect.flatMap(
          FileSystem.FileSystem,
          (fs) =>
            Effect.flatMap(
              Path.Path,
              (path) =>
                Effect.flatMap(
                  path.fromFileUrl(new URL(import.meta.resolve(BUNDLE_SPECIFIER))),
                  (bundlePath) => fs.readFileString(bundlePath),
                ),
            ),
        )
      ),
    )
  )

const writeHtmlFile = (fileName: string, html: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.flatMap(Path.Path, (path) =>
      Effect.andThen(
        fs.makeDirectory(path.dirname(fileName), { recursive: true }),
        fs.writeFileString(fileName, html),
      )))

const loadBundle = (
  cached: Ref.Ref<string | undefined>,
): Effect.Effect<string, BadArgument | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.filterOrElse(
    Ref.get(cached),
    (hit): hit is string => hit !== undefined,
    () => Effect.tap(readBundleContent, (fresh) => Ref.set(cached, fresh)),
  )

const writeReportHtml = (
  fileName: string,
  event: MutationTestReportReady,
  cached: Ref.Ref<string | undefined>,
): Effect.Effect<void, BadArgument | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(loadBundle(cached), (bundle) =>
    writeHtmlFile(
      fileName,
      buildHtmlDocument(
        HtmlReportCommand.make({ report: event.report, scriptContent: bundle }),
      ).html,
    ))

const failAsHtmlReporter = (cause: unknown): ReporterFailed =>
  ReporterFailed.make({ reporterName: 'html', event: 'mutationTestReportReady', cause: errorToString(cause) })

const writeReportHtmlIfReady = (
  fileName: string,
  event: unknown,
  cached: Ref.Ref<string | undefined>,
): Effect.Effect<void, ReporterFailed, FileSystem.FileSystem | Path.Path> => {
  if (S.is(MutationTestReportReady)(event)) {
    return writeReportHtml(fileName, event, cached).pipe(Effect.mapError(failAsHtmlReporter))
  }
  return Effect.void
}

const streamErrorOf = (cause: unknown): ReporterFailed =>
  ReporterFailed.make({ reporterName: 'html', event: 'mutationTestReportReady', cause: errorToString(cause) })

const drainEvents = (
  fileName: string,
  events: AsyncIterable<unknown>,
): Effect.Effect<void, ReporterFailed, FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(
    Ref.make<string | undefined>(undefined),
    (cached) =>
      Stream.runForEach(Stream.fromAsyncIterable(events, streamErrorOf), (event) =>
        writeReportHtmlIfReady(fileName, event, cached)),
  )

export const makeHtmlReporter: ReporterFactory = (options, _init) => (events) =>
  Effect.provide(drainEvents(options.htmlReporter.fileName, events), nodeFsPathLayer)
