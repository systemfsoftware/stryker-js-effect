import { Blueprint } from '@systemfsoftware/effect-cell-types'
import type * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import type * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'

import { acquireSandboxCell } from './acquire-sandbox.cell.js'
import type { ProjectFiles } from './project-files.service.js'
import type { SandboxHandle } from './Sandbox.handle.js'
import type { FilePreprocessor, MakeSandboxInput, SandboxSpec } from './Sandbox.schema.js'
import type { StrykerError } from './stryker-error.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/Sandbox')
export type TypeId = typeof TypeId

export const Sandboxes = Blueprint.make<SandboxSpec>()(TypeId).steps({
  steps: {
    withPreprocessor: (spec: SandboxSpec, preprocessor: FilePreprocessor): SandboxSpec => ({
      ...spec,
      preprocessors: [...spec.preprocessors, preprocessor],
    }),
  },
  targets: {
    scoped: (spec: SandboxSpec): Effect.Effect<
      SandboxHandle,
      PlatformError | StrykerError,
      | FileSystem.FileSystem
      | Path.Path
      | ProjectFiles
      | ChildProcessSpawner.ChildProcessSpawner
      | Scope.Scope
    > => acquireSandboxCell.run(spec),
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
    <Id>(service: Context.Key<Id, SandboxHandle>) => Layer.effect(service)(acquireSandboxCell.run(spec)),
  },
})

export type SandboxResource = Blueprint.Of<typeof Sandboxes>

export const make = (spec: MakeSandboxInput): SandboxResource => Sandboxes.of({ ...spec, preprocessors: [] })

export const withPreprocessor = Sandboxes.operations.withPreprocessor

export const makeSandbox = (
  input: MakeSandboxInput,
): Effect.Effect<
  SandboxHandle,
  PlatformError | StrykerError,
  | FileSystem.FileSystem
  | Path.Path
  | ProjectFiles
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope
> => make(input).scoped
