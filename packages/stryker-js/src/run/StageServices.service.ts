import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'

import { GitDiff } from '../git-diff.service.js'
import { MutationReporting } from '../mutation-reporting.service.js'
import { ProjectFiles } from '../project-files.service.js'
import { Reporter } from '../reporter.service.js'
import { RunEvents, WorkerReports } from '../run-events.service.js'
import { SourceParser } from '../source-parser.service.js'
import { IdGenerator } from '../Worker.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import { PhaseClock } from './phase-clock.service.js'
import { RunEnvironment } from './RunEnvironment.service.js'

export type StageServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | GitDiff
  | IdGenerator
  | MutationReporting
  | Path.Path
  | PhaseClock
  | ProjectFiles
  | SourceParser
  | Reporter
  | RunEnvironment
  | RunEvents
  | WorkerReports
  | Scope.Scope
  | Stdio.Stdio
  | WorkerLauncher

export type EnginePorts =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | GitDiff
  | Path.Path
  | SourceParser
  | Stdio.Stdio
  | WorkerLauncher
export type RunStageServices =
  | ProjectFiles
  | Reporter
  | RunEnvironment
  | RunEvents
  | WorkerReports
  | IdGenerator
  | MutationReporting
  | PhaseClock
  | Scope.Scope

export type WiredRunLayer = Layer.Layer<RunStageServices | EnginePorts, never, never>
