import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import { ProjectFiles } from '../project-files.service.js'
import { RunEvents } from '../run-events.service.js'
import { VmRunner } from '../VmRunner.js'
import { IdGenerator } from '../Worker.js'
import { WorkerLauncher } from '../WorkerLauncher.js'
import { RunEnvironment } from './RunEnvironment.service.js'

export type StageServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | IdGenerator
  | Path.Path
  | ProjectFiles
  | RunEnvironment
  | RunEvents
  | Scope.Scope
  | Stdio.Stdio
  | VmRunner
  | WorkerLauncher

export type EnginePorts =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | Stdio.Stdio
  | VmRunner
  | WorkerLauncher

export type RunStageServices = ProjectFiles | RunEnvironment | RunEvents | IdGenerator | Scope.Scope

export type WiredRunLayer = Layer.Layer<RunStageServices | EnginePorts, never, never>
