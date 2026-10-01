export const SOURCE_CONDITION = '@systemfsoftware/source'

/**
 * @param {string} dtsExt
 * @param {string} mjsPath
 */
export const typesPathFor = (dtsExt, mjsPath) => mjsPath.replace(/\.mjs$/, dtsExt)

/**
 * Workspace entries order the source condition before `types`: the `types`
 * key matches unconditionally, so a first-position `types` makes tsc resolve
 * the built declaration instead of the source the condition names.
 * @param {string | Record<string, string | undefined>} entry
 * @param {string} dtsExt
 * @returns {string | Record<string, string | undefined>}
 */
export const withSourceFirst = (entry, dtsExt) => {
  if (typeof entry === 'string') return { types: typesPathFor(dtsExt, entry), default: entry }
  /** @type {Record<string, string | undefined>} */
  const ordered = {}
  if (entry[SOURCE_CONDITION] != null) ordered[SOURCE_CONDITION] = entry[SOURCE_CONDITION]
  ordered['types'] = entry['types'] ?? typesPathFor(dtsExt, entry['default'] ?? '')
  ordered['default'] = entry['default']
  return ordered
}

/**
 * @param {object} [options]
 * @param {string} [options.dtsExt]
 * @param {readonly string[]} [options.documents] files published as they are,
 *   such as JSON contracts: each maps to `{ default }` because no declaration
 *   file exists for it to name as `types`
 */
export const sourceExports = ({ dtsExt = '.d.ts', documents = [] } = {}) => ({
  devExports: SOURCE_CONDITION,
  /** @param {Record<string, any>} exports */
  customExports: (exports) => {
    for (const [key, value] of Object.entries(exports)) {
      if (key === './package.json') continue
      exports[key] = withSourceFirst(value, dtsExt)
    }
    for (const document of documents) exports[document] = { default: document }
    return exports
  },
})
