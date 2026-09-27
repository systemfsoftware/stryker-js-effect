import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

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

import { writeHtmlReport } from './write-html-report.cell.js'

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
