import { dual } from 'effect/Function'

import type { VmAliasFind } from '../vitest-config.schema.js'

export interface AliasEntry {
  readonly find: VmAliasFind
  readonly replacement: string
}

type RegexAliasFind = Exclude<VmAliasFind, string>

const regexOf = (find: RegexAliasFind): RegExp => new RegExp(find.source, find.flags)

const isSameOrChildSpecifier = (find: string, specifier: string): boolean =>
  specifier === find || specifier.startsWith(`${find}/`)

const matchesStringPattern = (find: string, specifier: string): boolean =>
  specifier.length >= find.length && isSameOrChildSpecifier(find, specifier)

const matchesRegexPattern = (find: RegexAliasFind, specifier: string): boolean => regexOf(find).test(specifier)

const matchesPattern = (find: VmAliasFind, specifier: string): boolean =>
  typeof find === 'string' ? matchesStringPattern(find, specifier) : matchesRegexPattern(find, specifier)

const applyStringEntry = (entry: AliasEntry, find: string, specifier: string): string =>
  `${entry.replacement}${specifier.slice(find.length)}`

const applyRegexEntry = (entry: AliasEntry, find: RegexAliasFind, specifier: string): string =>
  specifier.replace(regexOf(find), entry.replacement)

const applyEntry = (entry: AliasEntry, specifier: string): string =>
  typeof entry.find === 'string'
    ? applyStringEntry(entry, entry.find, specifier)
    : applyRegexEntry(entry, entry.find, specifier)

const firstMatchingEntry = (
  specifier: string,
  aliases: ReadonlyArray<AliasEntry>,
): AliasEntry | undefined => aliases.find((entry) => matchesPattern(entry.find, specifier))

export const applyAlias = dual<
  (aliases: ReadonlyArray<AliasEntry>) => (specifier: string) => string | undefined,
  (specifier: string, aliases: ReadonlyArray<AliasEntry>) => string | undefined
>(2, (specifier: string, aliases: ReadonlyArray<AliasEntry>): string | undefined => {
  const entry = firstMatchingEntry(specifier, aliases)
  return entry === undefined ? undefined : applyEntry(entry, specifier)
})
