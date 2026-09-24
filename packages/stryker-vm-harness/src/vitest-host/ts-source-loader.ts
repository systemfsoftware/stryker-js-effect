import * as Option from 'effect/Option'

import type { ResolveFnOutput, ResolveHookContext } from '../session-plugin.js'

const moduleBuiltin = globalThis.process.getBuiltinModule('node:module')

const existsSync = (path: string | URL): boolean => globalThis.process.getBuiltinModule('node:fs').existsSync(path)

const isRelativeSpecifier = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../')

const mapsToTypeScript = (specifier: string): boolean => isRelativeSpecifier(specifier) && specifier.endsWith('.js')

const shouldRewrite = (jsUrl: URL, tsUrl: URL): boolean => !existsSync(jsUrl) && existsSync(tsUrl)

const rewrittenUrlOf = (specifier: string, parentURL: string): URL | undefined => {
  const jsUrl = new URL(specifier, parentURL)
  const tsUrl = new URL(`${specifier.slice(0, -3)}.ts`, parentURL)
  return shouldRewrite(jsUrl, tsUrl) ? tsUrl : undefined
}

const candidateTsUrlOf = (specifier: string, parentURL: string | undefined): Option.Option<URL> =>
  parentURL === undefined ? Option.none() : Option.fromNullishOr(rewrittenUrlOf(specifier, parentURL))

const resolveRewrittenUrlOf = (specifier: string, context: ResolveHookContext): Option.Option<URL> =>
  mapsToTypeScript(specifier) ? candidateTsUrlOf(specifier, context.parentURL) : Option.none()

const rewriteOutputOf = (specifier: string, context: ResolveHookContext): ResolveFnOutput | undefined =>
  Option.match(resolveRewrittenUrlOf(specifier, context), {
    onNone: () => undefined,
    onSome: (url) => ({ url: url.href, shortCircuit: true }),
  })

moduleBuiltin.registerHooks({
  resolve: (specifier, context, nextResolve) => rewriteOutputOf(specifier, context) ?? nextResolve(specifier, context),
})
