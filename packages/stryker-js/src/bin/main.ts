#!/usr/bin/env node
import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeStdio from '@effect/platform-node/NodeStdio'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Stdio from 'effect/Stdio'
import cliPkgJson from '../../package.json' with { type: 'json' }

import { strykerCliEffect } from '../Cli.js'
import { OutputModeProbe, OutputModeProbeLive } from '../Output.js'
import { RunEventStreamPort } from '../Output.js'
import { telemetryLayer } from '../platform/telemetry.js'
import { RunEventStreamFileLive } from '../StreamFile.js'

/** The major version `engines.node` floors the CLI at. */
const SUPPORTED_NODE_MAJOR = 20

process.title = 'stryker'

/** The numbers a `process.version` names; a component that does not parse stays `NaN`. */
const versionNumbers = (version: string): readonly number[] =>
  version
    .replace(/^v/, '')
    .split(/[-+]/)
    .slice(0, 1)
    .flatMap((base) => base.split('.'))
    .map((part) => Number.parseInt(part, 10))

const componentAt = (numbers: readonly number[], index: number): number =>
  Option.getOrElse(Option.fromUndefinedOr(numbers[index]), () => 0)

/** Every reason the CLI refuses the running Node.js, checked against the parsed version numbers. */
const NODE_VERSION_REJECTIONS: readonly ((numbers: readonly number[]) => boolean)[] = [
  (numbers) => numbers.some(Number.isNaN),
  (numbers) => componentAt(numbers, 0) < SUPPORTED_NODE_MAJOR,
]

function isSupportedNodeVersion(version: string): boolean {
  const numbers = versionNumbers(version)
  return !NODE_VERSION_REJECTIONS.some((rejects) => rejects(numbers))
}

if (!isSupportedNodeVersion(process.version)) {
  throw new Error(
    `Node.js version ${process.version} detected. StrykerJS requires version to match ${cliPkgJson.engines.node}. Please update your Node.js version or visit https://nodejs.org/ for additional instructions`,
  )
}

const program = Effect.gen(function*() {
  const outputMode = yield* OutputModeProbe
  const runEvents = yield* RunEventStreamPort
  const stdio = yield* Stdio.Stdio
  const args = [...(yield* stdio.args)]
  yield* strykerCliEffect(args, undefined, outputMode.detectMode, runEvents.createRunEventStream)
})
  .pipe(
    Effect.provideService(Logger.LogToStderr, true),
    Effect.provide(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.merge(OutputModeProbeLive, RunEventStreamFileLive).pipe(
            Layer.provide(Layer.mergeAll(NodeStdio.layer, NodeFileSystem.layer, NodePath.layer)),
          ),
          telemetryLayer,
          NodeStdio.layer,
        ),
        Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
      ),
    ),
  )
NodeRuntime.runMain({ disableErrorReporting: true })(program)
