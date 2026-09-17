import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import { RunEvents } from '@systemfsoftware/stryker-js-language'
import { IdGenerator } from '../Worker.js'
import { WorkerLauncher } from '../WorkerLauncher.js'
import { RunEnvironment } from './RunEnvironment.js'

export type StageServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | IdGenerator
  | Path.Path
  | RunEnvironment
  | RunEvents
  | Scope.Scope
  | Stdio.Stdio
  | WorkerLauncher

export type EnginePorts =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | Stdio.Stdio
  | WorkerLauncher

export type RunStageServices = RunEnvironment | RunEvents | IdGenerator | Scope.Scope

export type WiredRunLayer = Layer.Layer<RunStageServices | EnginePorts, never, never>
