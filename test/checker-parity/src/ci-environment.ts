import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Str from 'effect/String'

import { ShellFailure } from './Shell.schema.js'

export interface CiEnvironment {
  readonly ci: boolean
  readonly githubActions: boolean
  readonly pushEvent: boolean
  readonly stepSummary: Option.Option<string>
  readonly runId: string
}

const optionalText = (name: string): Config.Config<Option.Option<string>> =>
  Config.String(name).pipe(Config.option, Config.map(Option.filter(Str.isNonEmpty)))

export const ciEnvironment: Effect.Effect<CiEnvironment, ShellFailure> = Config.all({
  ci: optionalText('CI'),
  githubActions: optionalText('GITHUB_ACTIONS'),
  eventName: optionalText('GITHUB_EVENT_NAME'),
  stepSummary: optionalText('GITHUB_STEP_SUMMARY'),
  runId: optionalText('GITHUB_RUN_ID'),
}).pipe(
  Effect.map((read) => ({
    ci: Option.isSome(read.ci),
    githubActions: Option.contains(read.githubActions, 'true'),
    pushEvent: Option.contains(read.eventName, 'push'),
    stepSummary: read.stepSummary,
    runId: Option.getOrElse(read.runId, () => '<run-id>'),
  })),
  Effect.mapError((cause) =>
    ShellFailure.make({
      schemaVersion: 1,
      code: 'usage-error',
      reason: `The CI environment could not be read: ${cause.message}`,
      nextAction: 'Check CI, GITHUB_ACTIONS, GITHUB_EVENT_NAME, GITHUB_STEP_SUMMARY and GITHUB_RUN_ID.',
    })
  ),
)

export const readsCache = (environment: CiEnvironment): boolean => !(environment.ci && environment.pushEvent)

export const appendStepSummary: {
  (markdown: string): (environment: CiEnvironment) => Effect.Effect<void, ShellFailure, FileSystem.FileSystem>
  (environment: CiEnvironment, markdown: string): Effect.Effect<void, ShellFailure, FileSystem.FileSystem>
} = dual(
  2,
  (environment: CiEnvironment, markdown: string): Effect.Effect<void, ShellFailure, FileSystem.FileSystem> =>
    Option.match(Option.filter(environment.stepSummary, () => environment.githubActions), {
      onNone: () => Effect.void,
      onSome: (summaryPath) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem.FileSystem
          yield* fs.writeFileString(summaryPath, markdown, { flag: 'a' })
        }).pipe(
          Effect.mapError((cause) =>
            ShellFailure.make({
              schemaVersion: 1,
              code: 'io-failed',
              reason: `Could not append to $GITHUB_STEP_SUMMARY: ${cause.message}`,
              nextAction: 'Check the runner exposes a writable GITHUB_STEP_SUMMARY.',
            })
          ),
        ),
    }),
)
