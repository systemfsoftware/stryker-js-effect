import { test as baseTest } from 'vitest'

import {
  ensureContainerEnvironment,
  type ExecResult,
  installFixture,
  readWorkspaceFile,
  runCli,
  teardownContainerEnvironment,
} from './container-environment.js'

export interface ContainerHarness {
  readonly install: (fixtureUrl: URL, name: string) => Promise<string>
  readonly run: (args: readonly string[], opts: { readonly cwd: string }) => Promise<ExecResult>
}
export interface PreparedFixture {
  readonly path: string
  readonly run: (args: readonly string[]) => Promise<ExecResult>
  readonly readFile: (relativePath: string) => Promise<string>
}

export interface BddStepContext {
  readonly given: (description: string, fn?: () => Promise<void> | void) => Promise<void>
  readonly when: (description: string, fn?: () => Promise<void> | void) => Promise<void>
  readonly thenAssert: (description: string, fn?: () => Promise<void> | void) => Promise<void>
  readonly and: (description: string, fn?: () => Promise<void> | void) => Promise<void>
}

export interface ExtendedTestContext {
  readonly containerHarness: ContainerHarness
  readonly prepareFixture: (fixtureUrl: URL, name: string) => Promise<PreparedFixture>
  readonly bdd: BddStepContext
}

export const test = baseTest
  .extend<Pick<ExtendedTestContext, 'containerHarness'>>({
    containerHarness: [
      async ({ onTestFinished: _onTestFinished }, use) => {
        await ensureContainerEnvironment()
        await use(
          {
            install: (fixtureUrl: URL, name: string) => installFixture(fixtureUrl, name),
            run: (args: readonly string[], opts: { readonly cwd: string }) => runCli(args, opts),
          } satisfies ContainerHarness,
        )
        await teardownContainerEnvironment()
      },
      { scope: 'file' },
    ],
  })
  .extend<Pick<ExtendedTestContext, 'prepareFixture' | 'bdd'>>({
    prepareFixture: async ({ containerHarness }, use) => {
      await use((fixtureUrl: URL, name: string): Promise<PreparedFixture> =>
        containerHarness.install(fixtureUrl, name).then((path) => ({
          path,
          run: (args: readonly string[]) => containerHarness.run(args, { cwd: path }),
          readFile: (relativePath: string) => readWorkspaceFile(`${path}/${relativePath}`),
        }))
      )
    },
    bdd: async ({ annotate }, use) => {
      await use(
        {
          given: async (desc, fn) => {
            await annotate(`Given ${desc}`, 'lifecycle')
            if (fn) await fn()
          },
          when: async (desc, fn) => {
            await annotate(`When ${desc}`, 'execution')
            if (fn) await fn()
          },
          thenAssert: async (desc, fn) => {
            await annotate(`Then ${desc}`, 'assertions')
            if (fn) await fn()
          },
          and: async (desc, fn) => {
            await annotate(`And ${desc}`, 'assertions')
            if (fn) await fn()
          },
        } satisfies BddStepContext,
      )
    },
  })

export { describe, expect, it } from 'vitest'
export type { ExpectStatic } from 'vitest'
