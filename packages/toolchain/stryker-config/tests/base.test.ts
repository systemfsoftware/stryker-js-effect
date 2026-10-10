import { installedPlugin, sharedConfig } from '@systemfsoftware/stryker-config'
import { afterAll, describe, it } from '@systemfsoftware/vitest'
import { Schema as S } from 'effect'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const realTempDir = (prefix: string): string => realpathSync(mkdtempSync(join(tmpdir(), prefix)))

const root = realTempDir('stryker-config-')
afterAll(() => rmSync(root, { force: true, recursive: true }))

const pluginDir = join(root, 'plugin-host')
const pluginNames = ['fixture-alpha', 'fixture-beta'] as const
for (const name of pluginNames) {
  const dir = join(pluginDir, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), '')
}
const configUrl = pathToFileURL(join(pluginDir, 'stryker.config.js')).href
const installedHref = (name: string): string => pathToFileURL(join(pluginDir, 'node_modules', name, 'index.js')).href

describe('installedPlugin', () => {
  it('resolves a specifier from the config dir node_modules', function*({ expect }) {
    const resolved = pluginNames.map((name) => installedPlugin(name, configUrl))
    yield* expect(resolved).toEqual(pluginNames.map(installedHref))
  })

  it('ignores the package self-reference in favor of the installed copy', function*({ expect }) {
    const host = join(root, 'self-ref-host')
    mkdirSync(join(host, 'node_modules', 'fixture-alpha'), { recursive: true })
    writeFileSync(join(host, 'package.json'), JSON.stringify({ name: 'fixture-alpha', exports: { '.': './own.js' } }))
    writeFileSync(join(host, 'own.js'), '')
    writeFileSync(
      join(host, 'node_modules', 'fixture-alpha', 'package.json'),
      JSON.stringify({ name: 'fixture-alpha', main: 'index.js' }),
    )
    writeFileSync(join(host, 'node_modules', 'fixture-alpha', 'index.js'), '')
    const resolved = installedPlugin('fixture-alpha', pathToFileURL(join(host, 'stryker.config.js')).href)
    yield* expect(resolved).toEqual(pathToFileURL(join(host, 'node_modules', 'fixture-alpha', 'index.js')).href)
  })

  it.prop(
    '∀ specifier: resolves the node_modules copy the config dir installed',
    {
      of: [S.Literals(pluginNames)],
      subject: (specifier: (typeof pluginNames)[number]) => installedPlugin(specifier, configUrl),
    },
    (subject, [specifier]) => subject(specifier) === installedHref(specifier),
  )
})
