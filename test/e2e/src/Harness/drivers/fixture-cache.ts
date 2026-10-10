import { Boolean, Cache, Config, Effect, FileSystem, Layer, Option, Path, Schema, Scope } from 'effect'

import { FixtureKeys } from '../bake-key.schema.js'
import type { BakePlatform } from '../fixture-cache.service.js'
import { BakedFixtureCache, entryNameOf } from '../fixture-cache.service.js'
import { FixtureMissingFailure } from '../harness-failure.schema.js'
import type { HarnessError } from '../harness-failure.schema.js'
import { seamSpan, SpanNames } from '../seam-span.js'
import * as Warm from '../warm-sandbox.handle.js'

const warmFixtureInto = (
  scope: Scope.Scope,
  fixtureUrl: URL,
): Effect.Effect<Warm.WarmSandbox, HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const hostFixtureDir = yield* path.fromFileUrl(fixtureUrl).pipe(Effect.orDie)
    const fixtureId = path.basename(hostFixtureDir)
    const stat = yield* Effect.option(fs.stat(hostFixtureDir))
    yield* Boolean.match(Option.exists(stat, (info) => info.type === 'Directory'), {
      onTrue: () => Effect.void,
      onFalse: () => Effect.fail(new FixtureMissingFailure({ directory: hostFixtureDir })),
    })
    const bakedRoot = yield* resolveBakedRoot
    const keys = yield* resolveFixtureKeys
    const key = yield* Option.match(Option.fromNullishOr(keys[fixtureId]), {
      onNone: () => Effect.fail(new FixtureMissingFailure({ directory: `${bakedRoot}/${fixtureId}` })),
      onSome: (present) => Effect.succeed(present),
    })
    const entryDir = path.join(bakedRoot, entryNameOf({ fixtureId, key }))
    const entryExists = yield* fs.exists(entryDir)
    yield* Boolean.match(entryExists, {
      onTrue: () => Effect.void,
      onFalse: () => Effect.fail(new FixtureMissingFailure({ directory: entryDir })),
    })
    return yield* Warm.boot(entryDir, fixtureId).pipe(Scope.provide(scope))
  }).pipe(seamSpan(SpanNames.install, { 'e2e.fixture': fixtureUrl.href }))

export const layer = Layer.effect(
  BakedFixtureCache,
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const root = yield* Effect.cached(resolveBakedRoot)
    const warmed = yield* Cache.make({
      capacity: 16,
      lookup: (fixtureHref: string) => warmFixtureInto(scope, new URL(fixtureHref)),
      requireServicesAt: 'lookup',
    })
    return {
      root,
      warm: (fixtureUrl: URL) => Cache.get(warmed, fixtureUrl.href),
    }
  }),
)

const resolveBakedRoot = Config.String(BakedFixtureCache.BAKED_ROOT_ENV)

const resolveFixtureKeys = Config.schema(
  Schema.fromJsonString(FixtureKeys),
  BakedFixtureCache.BAKED_KEYS_ENV,
)
