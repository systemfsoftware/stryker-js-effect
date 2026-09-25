import { access, readFile } from 'node:fs/promises'

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export const exists = (path) => access(path).then(() => true, () => false)

/**
 * @param {ReadonlyArray<string>} paths
 * @returns {Promise<string | undefined>}
 */
export const firstExisting = async (paths) =>
  (await Promise.all(paths.map(async (path) => ((await exists(path)) ? path : undefined)))).find(
    (path) => path !== undefined,
  )

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
