import * as Context from 'effect/Context'

/**
 * Port over the host module loader, shaped as the one capability feature code
 * needs: finding the `package.json` manifest a bare specifier resolves to,
 * walking `node_modules` upward from a base file. A specifier that resolves
 * to no package answers `undefined` — the port never throws past its
 * boundary. The Node implementation ships in the plugin-runtime package
 * (`@systemfsoftware/stryker-js-plugin-runtime`); tests that do not need real
 * resolution substitute a layer returning fixed paths.
 *
 * @since 2.0.0
 */
export class Module extends Context.Service<Module, {
  readonly findPackageJSON: (specifier: string, base: string) => string | undefined
}>()('@systemfsoftware/stryker-js-language/Module') {}
