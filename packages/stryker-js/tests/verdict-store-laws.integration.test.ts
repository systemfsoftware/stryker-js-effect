import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { type VerdictStore, VerdictStoreUnavailable } from '@systemfsoftware/stryker-js/verdict-store'
import { fsVerdictStoreLayer } from '@systemfsoftware/stryker-js/verdict-store/fs'
import { VerdictStoreHarness, verdictStoreLaws } from '@systemfsoftware/stryker-js/verdict-store/laws'
import { memoryVerdictStoreLayer } from '@systemfsoftware/stryker-js/verdict-store/memory'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

interface StoreUnderLaw {
  readonly layer: Layer.Layer<VerdictStore | VerdictStoreHarness, VerdictStoreUnavailable>
  readonly release: Effect.Effect<void>
}

const memoryStore: Effect.Effect<StoreUnderLaw> = Effect.succeed({
  layer: memoryVerdictStoreLayer,
  release: Effect.void,
})

const fsStoreInFreshDirectory: Effect.Effect<StoreUnderLaw, PlatformError, FileSystem.FileSystem | Path.Path> = Effect
  .gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory({ prefix: 'verdict-store-laws-' })
    const harness = Layer.succeed(VerdictStoreHarness, {
      plant: (name, text) =>
        fs.makeDirectory(path.dirname(path.join(root, name)), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(path.join(root, name), text)),
          Effect.orDie,
        ),
      reset: fs.remove(root, { recursive: true }).pipe(
        Effect.andThen(fs.makeDirectory(root, { recursive: true })),
        Effect.orDie,
      ),
    })
    return {
      layer: Layer.merge(fsVerdictStoreLayer(root).pipe(Layer.provide(filePorts)), harness),
      release: Effect.ignore(fs.remove(root, { recursive: true })),
    }
  })

const ADAPTERS = [
  { adapter: 'in-memory', open: memoryStore },
  { adapter: 'filesystem', open: fsStoreInFreshDirectory },
] as const

const rows = ADAPTERS.flatMap(({ adapter, open }) =>
  verdictStoreLaws.map(({ law, history }) => ({ adapter, law, open, history }))
)

const fileInFreshDirectory = (name: string): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.join(yield* fs.makeTempDirectory({ prefix: 'verdict-store-root-' }), name)
    yield* fs.writeFileString(file, '')
    return file
  })

const removeParentOf = (file: string): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Effect.ignore(fs.remove(path.dirname(file), { recursive: true }))
  })

Feature('Keeping mutation verdicts reusable across runs, shards and pull requests')
  .withLayer(filePorts)
  .live('the filesystem store writes, renames and lists real files in a temporary directory')
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'On the <adapter> store, <law>',
      rows,
      (row) =>
        Gherkin.Do.pipe(
          Given(`an empty ${row.adapter} verdict store`)('store', () => row.open),
          When('the verdicts behind that rule are written and read back')(
            'observation',
            (s) => row.history.pipe(Effect.provide(s.store.layer), Effect.ensuring(s.store.release)),
          ),
          Then('the store answers exactly what the rule promises')((s, expect) =>
            expect(s.observation.observed).toEqual(s.observation.expected)
          ),
        ),
    )

    scenario(
      'A store root that is a file stops the run before any verdict is read',
      Gherkin.Do.pipe(
        Given('a project whose verdict store path names a file')('root', () => fileInFreshDirectory('verdicts')),
        When('the filesystem store opens there')('refusal', (s) =>
          Layer.build(fsVerdictStoreLayer(s.root)).pipe(
            Effect.scoped,
            Effect.flip,
            Effect.ensuring(removeParentOf(s.root)),
          )),
        Then('the run is refused with a store error that names the path')((s, expect) =>
          expect(s.refusal).toEqual(
            VerdictStoreUnavailable.make({ store: s.root, reason: 'the store root is a File, not a directory' }),
          )
        ),
      ),
    )
  })
