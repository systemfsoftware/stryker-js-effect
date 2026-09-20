import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EFFECT_CELL_TYPES_PACKAGE,
  EFFECT_PACKAGE,
  effectCouplingViolations,
  type FixtureManifest,
  fixturePinViolations,
  type InstalledManifest,
  type InstalledManifests,
} from './__fixtures__/fixture-install-pins.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const FIXTURE_RESOURCES = join(REPO_ROOT, 'test', 'e2e', 'testResources')

const INSTALLING_PACKAGE = join(REPO_ROOT, 'packages', 'stryker-js')

const readManifest = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))

const fixtureManifests = async (): Promise<ReadonlyArray<FixtureManifest>> => {
  const entries = await readdir(FIXTURE_RESOURCES, { withFileTypes: true })
  const fixtures: FixtureManifest[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      fixtures.push((await readManifest(join(FIXTURE_RESOURCES, entry.name, 'package.json'))) as FixtureManifest)
    }
  }
  return fixtures
}

const installedManifests = async (): Promise<InstalledManifests> => {
  const effect = await readManifest(join(INSTALLING_PACKAGE, 'node_modules', EFFECT_PACKAGE, 'package.json'))
  const cellTypes = await readManifest(
    join(INSTALLING_PACKAGE, 'node_modules', EFFECT_CELL_TYPES_PACKAGE, 'package.json'),
  )
  return {
    [EFFECT_PACKAGE]: effect as InstalledManifest,
    [EFFECT_CELL_TYPES_PACKAGE]: cellTypes as InstalledManifest,
  }
}

describe('fixturePinViolations', () => {
  it('rejects a floated pin on a package that tracks the effect release', () => {
    const fixtures = [{ name: 'fixture', devDependencies: { '@systemfsoftware/effect-schema-law': '^2' } }]

    expect(fixturePinViolations(fixtures, {})).toHaveLength(1)
  })

  it('leaves a pin outside the namespaces that track the effect release alone', () => {
    const fixtures = [{ name: 'fixture', devDependencies: { vitest: '^4' } }]

    expect(fixturePinViolations(fixtures, {})).toEqual([])
  })
})

describe('the fixture registry install', () => {
  it('pins every Effect-coupled package at the version the workspace resolved', async () => {
    expect(fixturePinViolations(await fixtureManifests(), await installedManifests())).toEqual([])
  })

  it('resolves an effect-cell-types build whose effect peer is the workspace Effect release', async () => {
    expect(effectCouplingViolations(await installedManifests())).toEqual([])
  })
})
