import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type { PlatformError } from 'effect/PlatformError'

export interface EmptyDirectoryShape {
  readonly removeIfEmpty: (path: string) => Effect.Effect<void, PlatformError>
}

export class EmptyDirectory extends Context.Service<EmptyDirectory, EmptyDirectoryShape>()(
  '@systemfsoftware/stryker-js/empty-directory.service/EmptyDirectory',
) {}
