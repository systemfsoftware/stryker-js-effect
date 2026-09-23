import { describe, expect, it } from '@effect/vitest'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { layer as NodeCryptoLayer } from '@effect/platform-node/NodeCrypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as S from 'effect/Schema'

import { StrykerOptionsSchema, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { layer } from '../VitestRunner.service.js'

const platform = Layer.mergeAll(NodeCryptoLayer, NodeFileSystem.layer, NodePath.layer)

describe('tmp-finalizer-probe', () => {
  it('runner alive across two RPCs, finalized only at shutdown', async () => {
    const sandbox = await Effect.runPromise(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectory()
        const setup = `${dir}/setup.mjs`
        yield* fs.writeFileString(setup, 'export default {};\n')
        return { dir, setup }
      }).pipe(Effect.provide(platform)),
    )
    const options = await Effect.runPromise(S.decode(StrykerOptionsSchema)({}))
    const runnerLayer = layer({ options, sandboxDirectory: sandbox.dir, setupFilePath: sandbox.setup })
    const { beforeDispose, afterDispose } = await Effect.runPromise(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const countSetupFiles = Effect.gen(function*() {
          const entries = yield* fs.readDirectory(sandbox.dir)
          return entries.filter((entry) => entry.startsWith('stryker-setup-')).length
        })
        const context = yield* Layer.build(Layer.provide(runnerLayer, platform))
        const runner = context.get(TestRunner)
        yield* runner.init
        yield* runner.capabilities
        yield* runner.capabilities
        const before = yield* countSetupFiles
        yield* runner.dispose
        const after = yield* countSetupFiles
        return { beforeDispose: before, afterDispose: after }
      }).pipe(Effect.provide(platform), Effect.scoped),
    )
    console.log(`setup files after two RPCs: ${beforeDispose}, after dispose: ${afterDispose}`)
    expect(beforeDispose).toBe(1)
    expect(afterDispose).toBe(0)
    await Effect.runPromise(
      FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) => fs.remove(sandbox.dir, { recursive: true })),
        Effect.provide(platform),
      ),
    )
  })
})
