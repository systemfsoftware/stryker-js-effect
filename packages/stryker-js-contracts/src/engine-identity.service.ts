import * as Context from 'effect/Context'

export interface EngineManifest {
  readonly specifier: string
  readonly url: string
}

export interface EngineIdentityShape {
  readonly framework: { readonly name: string; readonly version: string }
  readonly manifests: ReadonlyArray<EngineManifest>
}

export class EngineIdentity extends Context.Service<EngineIdentity, EngineIdentityShape>()(
  '@systemfsoftware/stryker-js-contracts/EngineIdentity',
) {}
