import { Blueprint } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'

import { linkNodeModulesCell } from './link-node-modules.cell.js'
import { prepareSandboxCell } from './prepare-sandbox.cell.js'
import type { ProjectFiles } from './project-files.service.js'
import { sandboxBuildCell } from './sandbox-build.cell.js'
import type { SandboxHandle } from './Sandbox.handle.js'
import type { SandboxSpec } from './Sandbox.schema.js'
import type { StrykerError } from './stryker-error.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/Sandbox')
export type TypeId = typeof TypeId

type SandboxServices =
  | FileSystem.FileSystem
  | Path.Path
  | ProjectFiles
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope

const acquire = Effect.fn(SpanTaxonomy.Spans.sandboxAcquire.name)(function*(
  spec: SandboxSpec,
): Effect.fn.Return<SandboxHandle, PlatformError | StrykerError, SandboxServices> {
  const prepared = yield* prepareSandboxCell.run(spec)
  yield* Option.match(prepared.build, {
    onNone: () => Effect.void,
    onSome: (build) => Effect.scoped(sandboxBuildCell.run(build)),
  })
  yield* linkNodeModulesCell.run(prepared.link)
  return prepared.handle
})

const Sandboxes = Blueprint.make<SandboxSpec>()(TypeId).steps({
  steps: {},
  targets: {
    scoped: (spec: SandboxSpec): Effect.Effect<SandboxHandle, PlatformError | StrykerError, SandboxServices> =>
      acquire(spec),
    layer: (
      spec: SandboxSpec,
    ): <Id>(service: Context.Key<Id, SandboxHandle>) => Layer.Layer<
      Id,
      PlatformError | StrykerError,
      | FileSystem.FileSystem
      | Path.Path
      | ProjectFiles
      | ChildProcessSpawner.ChildProcessSpawner
    > =>
    <Id>(service: Context.Key<Id, SandboxHandle>) => Layer.effect(service)(acquire(spec)),
  },
})

export const makeSandbox = (
  input: SandboxSpec,
): Effect.Effect<SandboxHandle, PlatformError | StrykerError, SandboxServices> => Sandboxes.of(input).scoped
