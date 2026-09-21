import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'
import { startVitest } from 'vitest/node'

const setupFile = fileURLToPath(new URL('../stryker-setup.ts', import.meta.url))

test('setup hooks register under Vitest fixture parsing and record dry-run coverage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stryker-setup-'))
  await writeFile(
    join(root, 'sample.test.ts'),
    [
      "import { expect, test } from 'vitest'",
      "test('passes', () => {",
      '  expect(1).toBe(1)',
      '})',
      '',
    ].join('\n'),
  )
  const vitest = await startVitest(
    'test',
    [],
    {
      root,
      config: false,
      watch: false,
      reporters: [],
      include: ['sample.test.ts'],
      setupFiles: [setupFile],
      provide: {
        globalNamespace: '__stryker__',
        mutantActivation: 'runtime',
        mode: 'dry-run',
        hitLimit: undefined,
        activeMutant: undefined,
      },
    },
    undefined,
    undefined,
  )
  try {
    const [file] = vitest.state.getFiles()
    expect(file?.result?.state).toBe('pass')
    expect(file?.result?.errors ?? []).toEqual([])
  } finally {
    await vitest.close()
  }
})
