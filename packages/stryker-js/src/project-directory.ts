import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'

export const projectsOf = (projects: ReadonlyArray<string> | undefined): ReadonlyArray<string> =>
  Option.getOrElse(Option.filter(Option.fromUndefinedOr(projects), Arr.isReadonlyArrayNonEmpty), () => ['.'])

const inProjectDirectory = <A, E, R>(directory: string, body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const previous = globalThis.process.cwd()
    return Effect.acquireUseRelease(
      Effect.sync(() => globalThis.process.chdir(directory)),
      () => body,
      () => Effect.sync(() => globalThis.process.chdir(previous)),
    )
  })

/**
 * Runs `body` once per `--projects` entry, one at a time, with the process
 * working directory switched to that entry, because config discovery reads
 * the working directory. No entries means the working directory alone.
 */
export const forEachProjectDirectory: {
  <A, E, R>(
    body: (directory: string) => Effect.Effect<A, E, R>,
  ): (projects: ReadonlyArray<string> | undefined) => Effect.Effect<ReadonlyArray<A>, E, R>
  <A, E, R>(
    projects: ReadonlyArray<string> | undefined,
    body: (directory: string) => Effect.Effect<A, E, R>,
  ): Effect.Effect<ReadonlyArray<A>, E, R>
} = dual(2, <A, E, R>(
  projects: ReadonlyArray<string> | undefined,
  body: (directory: string) => Effect.Effect<A, E, R>,
): Effect.Effect<ReadonlyArray<A>, E, R> =>
  Effect.forEach(projectsOf(projects), (directory) => inProjectDirectory(directory, body(directory)), {
    concurrency: 1,
  }))
