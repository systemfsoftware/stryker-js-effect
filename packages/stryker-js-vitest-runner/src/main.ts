/**
 * The worker entry. The runner borrows the project's vitest (`deps.onlyImport` in
 * tsdown.config.ts), so every `vitest` import the worker makes resolves from the sandbox
 * it runs in, never from where the runner is installed: a runner installed outside the
 * project, such as the flake's `stryker` package, has no vitest beside it. The hook is
 * registered before the worker module loads, because its static imports link first.
 */
import { registerHooks } from 'node:module'
import { env } from 'node:process'
import { pathToFileURL } from 'node:url'

const sandbox = pathToFileURL(`${env['STRYKER_SANDBOX_DIR'] ?? ''}/`).href

const borrowed = (specifier: string): boolean => specifier === 'vitest' || specifier.startsWith('vitest/')

registerHooks({
  resolve: (specifier, context, nextResolve) =>
    nextResolve(specifier, borrowed(specifier) ? { ...context, parentURL: sandbox } : context),
})

await import(new URL('./worker.mjs', import.meta.url).href)
