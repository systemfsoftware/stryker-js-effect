import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  readPackableWorkspaceManifests,
  resolveWorkspaceClosure,
  type WorkspaceManifest,
} from './__fixtures__/closure-resolver.js'
import { ENTRY_PACKAGES } from './__fixtures__/container-environment.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const manifestsOf = (
  manifests: ReadonlyArray<WorkspaceManifest>,
): ReadonlyMap<string, WorkspaceManifest> => new Map(manifests.map((manifest) => [manifest.name, manifest]))

describe('resolveWorkspaceClosure', () => {
  it('resolves the shipped closure of the e2e entry packages', async () => {
    const closure = resolveWorkspaceClosure(await readPackableWorkspaceManifests(REPO_ROOT), ENTRY_PACKAGES)

    expect(closure).toEqual([
      '@systemfsoftware/stryker-js',
      '@systemfsoftware/stryker-js-instrumenter',
      '@systemfsoftware/stryker-js-plugin-interface',
      '@systemfsoftware/stryker-js-plugin-runtime',
      '@systemfsoftware/stryker-js-typescript-checker',
      '@systemfsoftware/stryker-js-vitest-runner',
      '@systemfsoftware/stryker-vm-harness',
    ])
  })

  it('follows peer and transitive workspace dependencies', () => {
    const closure = resolveWorkspaceClosure(
      manifestsOf([
        { name: 'entry', peerDependencies: { peer: 'workspace:^' } },
        { name: 'peer', dependencies: { transitive: 'workspace:*' } },
        { name: 'transitive' },
      ]),
      ['entry'],
    )

    expect(closure).toEqual(['entry', 'peer', 'transitive'])
  })

  it('leaves dev dependencies out of the closure', () => {
    const closure = resolveWorkspaceClosure(
      manifestsOf([
        { name: 'entry', devDependencies: { tooling: 'workspace:^' } },
        { name: 'tooling' },
      ]),
      ['entry'],
    )

    expect(closure).toEqual(['entry'])
  })

  it('terminates on workspace dependency cycles', () => {
    const closure = resolveWorkspaceClosure(
      manifestsOf([
        { name: 'first', dependencies: { second: 'workspace:^' } },
        { name: 'second', peerDependencies: { first: 'workspace:^' } },
      ]),
      ['first'],
    )

    expect(closure).toEqual(['first', 'second'])
  })

  it('rejects a workspace spec naming a package it cannot pack', () => {
    const manifests = manifestsOf([{ name: 'entry', dependencies: { absent: 'workspace:^' } }])

    expect(() => resolveWorkspaceClosure(manifests, ['entry'])).toThrow(/absent/)
  })

  it('rejects an entry package that is not a workspace package', () => {
    expect(() => resolveWorkspaceClosure(manifestsOf([]), ['@systemfsoftware/absent'])).toThrow(
      /@systemfsoftware\/absent/,
    )
  })
})

describe('readPackableWorkspaceManifests', () => {
  it('reads flat and grouped package directories and leaves private and fixture manifests out', async () => {
    const manifests = await readPackableWorkspaceManifests(REPO_ROOT)

    expect(manifests.has('@systemfsoftware/stryker-js')).toBe(true)
    expect(manifests.has('@systemfsoftware/stryker-ignorer-interface')).toBe(true)
    expect(manifests.has('@systemfsoftware/vitest-config')).toBe(false)
    expect(manifests.has('bar')).toBe(false)
    expect(manifests.has('@acme/stryker-runner')).toBe(false)
  })
})
