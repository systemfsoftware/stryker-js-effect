import { test as baseTest } from 'vitest'

import {
  CONTAINER_WORKROOT,
  ensureContainerEnvironment,
  type ExecResult,
  installFixture,
  type PackedPackage,
  readContainerFile,
  runCli,
  teardownContainerEnvironment,
} from './container-environment.js'

export interface ContainerHarness {
  readonly workroot: string
  readonly install: (fixtureUrl: URL, name: string, extraTarballs?: readonly PackedPackage[]) => Promise<string>
  readonly run: (args: readonly string[], opts?: { readonly cwd?: string }) => Promise<ExecResult>
}
export interface PreparedFixture {
  readonly path: string
  readonly run: (args: readonly string[]) => Promise<ExecResult>
  readonly readFile: (relativePath: string) => Promise<string>
}

export const test = baseTest
  .extend(
    'containerHarness',
    { scope: 'file' },
    // eslint-disable-next-line no-empty-pattern
    async ({}, { onCleanup }) => {
      await ensureContainerEnvironment()
      onCleanup(async () => {
        await teardownContainerEnvironment()
      })
      const harness: ContainerHarness = {
        workroot: CONTAINER_WORKROOT,
        install: (fixtureUrl: URL, name: string, extraTarballs?: readonly PackedPackage[]) =>
          installFixture(fixtureUrl, name, extraTarballs),
        run: (args: readonly string[], opts?: { readonly cwd?: string }) => runCli(args, opts),
      }
      return harness
    },
  )
  .extend('prepareFixture', ({ containerHarness }) => {
    return (fixtureUrl: URL, name: string, extraTarballs?: readonly PackedPackage[]): Promise<PreparedFixture> =>
      containerHarness.install(fixtureUrl, name, extraTarballs).then((path) => ({
        path,
        run: (args: readonly string[]) => containerHarness.run(args, { cwd: path }),
        readFile: (relativePath: string) => readContainerFile(`${path}/${relativePath}`),
      }))
  })

export { describe, expect, it } from 'vitest'
export type { ExpectStatic } from 'vitest'
