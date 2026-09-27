import { assertEquals } from '@std/assert'

import { parseChangesetIntents } from './changeset-intents.ts'

const doc = (frontMatter: string) => `---\n${frontMatter}\n---\n\nSummary text.\n`

Deno.test('parses quoted and unquoted package intents with their bumps', () => {
  assertEquals(
    parseChangesetIntents(doc('"@systemfsoftware/stryker-js": major\n"stryker-js-vitest-runner": patch')),
    [
      { package: '@systemfsoftware/stryker-js', bump: 'major' },
      { package: 'stryker-js-vitest-runner', bump: 'patch' },
    ],
  )
})

Deno.test('ignores bumps outside the changeset vocabulary', () => {
  assertEquals(parseChangesetIntents(doc('"@systemfsoftware/stryker-js": huge')), [])
})

Deno.test('ignores a document without front matter or a body line in the matter', () => {
  assertEquals(parseChangesetIntents('# just prose\n\n"pkg": major'), [])
  assertEquals(parseChangesetIntents(doc('this line has no separator')), [])
})

Deno.test('keeps none intents, which name a package without releasing it', () => {
  assertEquals(parseChangesetIntents(doc('"@systemfsoftware/stryker-e2e-core": none')), [
    { package: '@systemfsoftware/stryker-e2e-core', bump: 'none' },
  ])
})
