import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import * as NodeStdio from '@effect/platform-node/NodeStdio'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'

import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { strykerCell } from '../index.js'
import type { MutationTestDone } from '../run/mutation-test.cell.js'

const runLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeStdio.layer)

export const run = (
  options: PartialStrykerOptions,
  targetMutatePatterns?: readonly string[],
): Promise<MutationTestDone> => {
  const runtime = ManagedRuntime.make(runLayer)
  return runtime.runPromise(strykerCell(options, targetMutatePatterns)).then(
    (done) => runtime.dispose().then(() => done),
    (cause) => runtime.dispose().then(() => Promise.reject(cause)),
  )
}
