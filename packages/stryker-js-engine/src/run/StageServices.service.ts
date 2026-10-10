import type { Incremental } from '@systemfsoftware/stryker-js-contracts'
import type { Workers } from '@systemfsoftware/stryker-js-contracts'
import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import type { Run } from '@systemfsoftware/stryker-js-contracts'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'

export type StageServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Incremental.GitDiff
  | Workers.IdGenerator
  | Reports.MutationReporting
  | Path.Path
  | Run.EngineIdentity
  | Run.PhaseClock
  | Run.ProjectFiles
  | Reports.Reporter
  | Run.RunEnvironment
  | Run.RunEvents
  | Run.WorkerReports
  | Scope.Scope
  | Stdio.Stdio
  | Workers.WorkerLauncher

export type PlatformPorts =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Incremental.GitDiff
  | Path.Path
  | Stdio.Stdio
  | Workers.WorkerLauncher
export type EnginePorts = PlatformPorts | Reports.Reporter | Run.EngineIdentity
export type RunStageServices =
  | Run.ProjectFiles
  | Run.RunEnvironment
  | Run.RunEvents
  | Run.WorkerReports
  | Workers.IdGenerator
  | Reports.MutationReporting
  | Run.PhaseClock
  | Scope.Scope

export type WiredRunLayer = Layer.Layer<RunStageServices | EnginePorts, never, never>
