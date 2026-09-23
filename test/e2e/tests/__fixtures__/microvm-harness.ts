import { test as baseTest } from 'vitest'

import {
  ensureMicroVMEnvironment,
  type ExecResult,
  installFixture,
  readWorkspaceFile,
  runCli,
  teardownMicroVMEnvironment,
} from './microvm-environment.js'

export interface MicroVMHarness {
  readonly install: (fixtureUrl: URL, name: string) => Promise<string>
  readonly run: (
    args: readonly string[],
    opts: { readonly cwd: string; readonly signal?: AbortSignal },
  ) => Promise<ExecResult>
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
  readonly microvmHarness: MicroVMHarness
  readonly prepareFixture: (fixtureUrl: URL, name: string) => Promise<PreparedFixture>
  readonly bdd: BddStepContext
}

export const test = baseTest
  .extend<Pick<ExtendedTestContext, 'microvmHarness'>>({
    microvmHarness: [
      async ({ onTestFinished: _onTestFinished }, use) => {
        await ensureMicroVMEnvironment()
        await use(
          {
            install: (fixtureUrl: URL, name: string) => installFixture(fixtureUrl, name),
            run: (args, opts) => runCli(args, opts),
          } satisfies MicroVMHarness,
        )
        await teardownMicroVMEnvironment()
      },
      { scope: 'file' },
    ],
  })
  .extend<Pick<ExtendedTestContext, 'prepareFixture' | 'bdd'>>({
    prepareFixture: async ({ microvmHarness, signal }, use) => {
      await use((fixtureUrl: URL, name: string): Promise<PreparedFixture> =>
        microvmHarness.install(fixtureUrl, name).then((path) => ({
          path,
          run: (args: readonly string[]) => microvmHarness.run(args, { cwd: path, signal }),
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
