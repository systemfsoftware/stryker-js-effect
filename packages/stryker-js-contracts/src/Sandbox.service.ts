import * as Context from 'effect/Context'

export interface TemporaryDirectoryShape {
  readonly path: string
}

export class TemporaryDirectory extends Context.Service<TemporaryDirectory, TemporaryDirectoryShape>()(
  '@systemfsoftware/stryker-js/Sandbox.service/TemporaryDirectory',
) {}
