import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { execText } from './exec-text.js'
import { ShellFailure } from './Shell.schema.js'
import { type LaneTrigger, triggerParityLane, TriggerParityLaneCommand } from './trigger-parity-lane.workflow.js'

const LANE_PACKAGES = ['@systemfsoftware/stryker-js-typescript-checker', '@systemfsoftware/stryker-checker-parity']

const decodeWorkspaceListing = S.decodeResult(S.fromJsonString(S.Array(S.Struct({ path: S.String }))))

export interface LaneTriggerInput {
  readonly base: string
  readonly pushEvent: boolean
  readonly repoRoot: string
}

const closureDirectories = (
  repoRoot: string,
): Effect.Effect<ReadonlyArray<string>, ShellFailure, ChildProcessSpawner.ChildProcessSpawner | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const listing = yield* execText({
      file: 'pnpm',
      args: [
        'ls',
        '--recursive',
        '--depth',
        '-1',
        '--json',
        ...LANE_PACKAGES.flatMap((name) => ['--filter', `${name}...`]),
      ],
      cwd: repoRoot,
    })
    const projects = yield* Effect.fromResult(
      Result.mapError(decodeWorkspaceListing(listing), (issue) =>
        ShellFailure.make({
          schemaVersion: 1,
          code: 'decode-failed',
          reason: `pnpm ls --json printed no workspace listing: ${issue.message}`,
          nextAction: 'Run `pnpm ls --recursive --depth -1 --json` at the repository root and check pnpm is installed.',
        })),
    )
    return projects.map((project) => path.relative(repoRoot, project.path).split(path.sep).join('/'))
  })

const changedFiles = (
  input: LaneTriggerInput,
): Effect.Effect<ReadonlyArray<string>, ShellFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.map(
    execText({ file: 'git', args: ['diff', '--name-only', `${input.base}...HEAD`], cwd: input.repoRoot }),
    (stdout) => stdout.split('\n').map((line) => line.trim()).filter(Str.isNonEmpty),
  )

export const laneTrigger = (
  input: LaneTriggerInput,
): Effect.Effect<LaneTrigger, ShellFailure, ChildProcessSpawner.ChildProcessSpawner | Path.Path> =>
  Effect.gen(function*() {
    const command = TriggerParityLaneCommand.make({
      pushEvent: input.pushEvent,
      closureDirectories: [...yield* closureDirectories(input.repoRoot)],
      changedFiles: input.pushEvent ? [] : [...yield* changedFiles(input)],
    })
    return yield* Effect.fromResult(triggerParityLane(command))
  })
