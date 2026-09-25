import * as Boolean from 'effect/Boolean'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'

import { AnsiCode } from '../reporting/ansi.schema.js'
import { PrepareError, StageError } from '../Run.schema.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'

export const announceSummary = (input: { readonly env: RunEnvironmentShape; readonly summary: string }) =>
  Match.value(input.env.resolvedMode.mode).pipe(
    Match.when(
      'human',
      () => announceHumanSummary({ allowConsoleColors: input.env.allowConsoleColors, summary: input.summary }),
    ),
    Match.orElse(() => Effect.logInfo(input.summary)),
  )

const announceHumanSummary = (input: { readonly allowConsoleColors: boolean; readonly summary: string }) =>
  Boolean.match(input.allowConsoleColors, {
    onTrue: () => Console.log(`${AnsiCode.fields.green.literal}${input.summary}${AnsiCode.fields.reset.literal}`),
    onFalse: () => Console.log(input.summary),
  })

const STREAM_REPORTER = 'progress-stream'
const HUMAN_REPORTER = 'clear-text'

const STDOUT_REPORTERS: Readonly<Record<string, true>> = { 'clear-text': true, 'progress': true }

const asHumanReporter = (name: string): string => {
  if (name === STREAM_REPORTER) {
    return HUMAN_REPORTER
  }
  return name
}

export const selectReporters: {
  (configured: readonly string[], mode: 'human' | 'machine'): readonly string[]
  (mode: 'human' | 'machine'): (configured: readonly string[]) => readonly string[]
} = dual(2, (configured: readonly string[], mode: 'human' | 'machine'): readonly string[] =>
  Match.value(mode).pipe(
    Match.when('human', () => [...new Set(configured.map(asHumanReporter))]),
    Match.when('machine', () => {
      const permitted = configured.filter((name) => STDOUT_REPORTERS[name] !== true)
      return Match.value(permitted.includes(STREAM_REPORTER)).pipe(
        Match.when(true, () => permitted),
        Match.when(false, () => [...permitted, STREAM_REPORTER]),
        Match.exhaustive,
      )
    }),
    Match.exhaustive,
  ))

export const failOnEmptyProject = (fileCount: number): Effect.Effect<void, StageError> =>
  Match.value(fileCount).pipe(
    Match.when(0, () =>
      Effect.fail(
        StageError.make({
          stage: 'prepare',
          reason: 'No input files found.',
          cause: PrepareError.make({ stage: 'prepare', reason: 'No input files found.' }),
        }),
      )),
    Match.orElse(() => Effect.void),
  )
