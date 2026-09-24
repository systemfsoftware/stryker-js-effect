import { expect, test } from 'vitest'

test('compares against a committed file snapshot', async () => {
  await expect('rendered output\nline two\n').toMatchFileSnapshot('./__snapshots__/output.txt')
})
