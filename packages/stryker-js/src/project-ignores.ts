import { strykerOutputSources } from './stryker-outputs.js'

export const ALWAYS_IGNORE = Object.freeze([
  'node_modules',
  '.git',
  '*.tsbuildinfo',
  '/stryker.log',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
])

const inlineCode = (pattern: string): string => `\`${pattern}\``

const listOf = (items: readonly string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

export const alwaysIgnoredDescription = [
  `These patterns are always ignored, whatever \`ignorePatterns\` holds: [${
    ALWAYS_IGNORE.map(inlineCode).join(', ')
  }].`,
  `Stryker's own output files are always excluded too: ${listOf(strykerOutputSources)}.`,
  'Other files under `reports/` are not ignored.',
].join(' ')
