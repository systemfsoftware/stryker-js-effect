import manifest from '../../package.json' with { type: 'json' }

const parts = manifest.peerDependencies.svelte.replace('>=', '').split('.')

export const VERSION = `${parts[0]}.${Number(parts[1]) - 1}.0`

/** @returns {{ html: Record<string, never> }} The compiler's own parse result shape. */
export const parse = () => ({ html: {} })

/**
 * @param {string} code Markup handed to the compiler.
 * @returns {Promise<{ code: string }>} The preprocessed code.
 */
export const preprocess = (code) => Promise.resolve({ code })

/** @returns {undefined} The walk this double never reaches. */
export const walk = () => undefined
