import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type { PlatformError } from 'effect/PlatformError'

export interface EmptyDirectoryShape {
  /**
   * Removes `path` when it is an empty directory.
   *
   * Resolving means the directory was removed, was already gone, or was left in place because it holds entries or
   * is not a directory. Any other failure rejects with a `PlatformError`.
   */
  readonly removeIfEmpty: (path: string) => Effect.Effect<void, PlatformError>
}

export class EmptyDirectory extends Context.Service<EmptyDirectory, EmptyDirectoryShape>()(
  '@systemfsoftware/stryker-js/empty-directory.service/EmptyDirectory',
) {}
