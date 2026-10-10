import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { VerdictStoreHarness } from './laws.js'
import { makeVerdictStore, type VerdictBlobs } from './verdict-blobs.js'
import { VerdictStore } from './VerdictStore.service.js'

type Objects = HashMap.HashMap<string, string>

const childNameOf = (directory: string) => (name: string): Option.Option<string> =>
  Option.liftPredicate(
    name.slice(directory.length + 1),
    (rest) => Arr.every([name.startsWith(`${directory}/`), rest.length > 0, !rest.includes('/')], (holds) => holds),
  )

const childNamesOf = (directory: string) => (objects: Objects): ReadonlyArray<string> =>
  objects.pipe(HashMap.keys, Arr.fromIterable, Arr.map(childNameOf(directory)), Arr.getSomes)

const memoryBlobsOf = (objects: Ref.Ref<Objects>): VerdictBlobs => ({
  read: (name) => Ref.get(objects).pipe(Effect.map(HashMap.get(name))),
  write: (name, text) => objects.pipe(Ref.update(HashMap.set(name, text))),
  list: (directory) => Ref.get(objects).pipe(Effect.map(childNamesOf(directory))),
})

const emptyObjects = (): Objects => HashMap.empty()

const contextOf = (objects: Ref.Ref<Objects>): Context.Context<VerdictStore | VerdictStoreHarness> =>
  objects.pipe(
    memoryBlobsOf,
    makeVerdictStore,
    (store) => Context.make(VerdictStore, store),
    Context.add(VerdictStoreHarness, {
      plant: (name, text) => objects.pipe(Ref.update(HashMap.set(name, text))),
      reset: objects.pipe(Ref.set(emptyObjects())),
    }),
  )

export const memoryVerdictStoreLayer: Layer.Layer<VerdictStore | VerdictStoreHarness> = Layer.effectContext(
  emptyObjects().pipe(Ref.make, Effect.map(contextOf)),
)
