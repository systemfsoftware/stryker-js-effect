import { Run } from '@systemfsoftware/stryker-js-contracts'
import cliPackage from '@systemfsoftware/stryker-js/package.json' with { type: 'json' }
import * as Layer from 'effect/Layer'

const ENGINE_PACKAGE_SPECIFIERS: readonly string[] = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-vm-runner',
]

export const layer: Layer.Layer<Run.EngineIdentity> = Layer.sync(Run.EngineIdentity, () =>
  Run.EngineIdentity.of({
    framework: { name: 'StrykerJS', version: cliPackage.version },
    manifests: ENGINE_PACKAGE_SPECIFIERS.map((specifier) => ({
      specifier,
      url: import.meta.resolve(`${specifier}/package.json`),
    })),
  }))
