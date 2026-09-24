import type { ResolveFnOutput, ResolveHookContext } from 'node:module'
import { registerHooks } from 'node:module'

type ResolveContinuation = (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput

const existsSync = (path: string | URL): boolean => process.getBuiltinModule('node:fs').existsSync(path)

const mapsToTypeScript = (specifier: string): boolean =>
  (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')

registerHooks({
  resolve: (specifier: string, context: ResolveHookContext, nextResolve: ResolveContinuation) => {
    if (mapsToTypeScript(specifier) && context.parentURL !== undefined) {
      const jsUrl = new URL(specifier, context.parentURL)
      const tsUrl = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)
      if (!existsSync(jsUrl) && existsSync(tsUrl)) {
        return { url: tsUrl.href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
})
