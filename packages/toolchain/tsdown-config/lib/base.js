export const SOURCE_CONDITION = '@systemfsoftware/source'

/**
 * @param {string} dtsExt
 * @param {string} mjsPath
 */
export const typesPathFor = (dtsExt, mjsPath) => mjsPath.replace(/\.mjs$/, dtsExt)

/**
 * @param {string | Record<string, string | undefined>} entry
 * @param {string} dtsExt
 * @returns {string | Record<string, string | undefined>}
 */
export const withTypesFirst = (entry, dtsExt) => {
  if (typeof entry === 'string') return { types: typesPathFor(dtsExt, entry), default: entry }
  /** @type {Record<string, string | undefined>} */
  const ordered = {}
  ordered['types'] = entry['types'] ?? typesPathFor(dtsExt, entry['default'] ?? '')
  if (entry[SOURCE_CONDITION] != null) ordered[SOURCE_CONDITION] = entry[SOURCE_CONDITION]
  ordered['default'] = entry['default']
  return ordered
}

/**
 * @param {object} [options]
 * @param {string} [options.dtsExt]
 */
export const sourceExports = ({ dtsExt = '.d.ts' } = {}) => ({
  devExports: SOURCE_CONDITION,
  /** @param {Record<string, any>} exports */
  customExports: (exports) => {
    for (const [key, value] of Object.entries(exports)) {
      if (key === './package.json') continue
      exports[key] = withTypesFirst(value, dtsExt)
    }
    return exports
  },
})
