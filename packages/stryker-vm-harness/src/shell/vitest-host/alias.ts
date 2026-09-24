import type { VmAliasFind } from '../../core/vitest-config.schema.js'

export interface AliasEntry {
  readonly find: VmAliasFind
  readonly replacement: string
}

const regexOf = (find: Exclude<VmAliasFind, string>): RegExp => new RegExp(find.source, find.flags)

const matchesPattern = (find: VmAliasFind, specifier: string): boolean =>
  typeof find === 'string'
    ? specifier.length >= find.length && (specifier === find || specifier.startsWith(`${find}/`))
    : regexOf(find).test(specifier)

const applyEntry = (entry: AliasEntry, specifier: string): string =>
  typeof entry.find === 'string'
    ? `${entry.replacement}${specifier.slice(entry.find.length)}`
    : specifier.replace(regexOf(entry.find), entry.replacement)

export const applyAlias = (
  specifier: string,
  aliases: ReadonlyArray<AliasEntry>,
): string | undefined => {
  for (const entry of aliases) {
    if (matchesPattern(entry.find, specifier)) {
      return applyEntry(entry, specifier)
    }
  }
  return undefined
}
