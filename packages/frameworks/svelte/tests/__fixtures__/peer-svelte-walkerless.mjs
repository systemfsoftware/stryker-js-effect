import manifest from '../../package.json' with { type: 'json' }

export const VERSION = manifest.devDependencies.svelte

/** @returns {{ html: Record<string, never> }} The compiler's own parse result shape. */
export const parse = () => ({ html: {} })

/**
 * @param {string} code Markup handed to the compiler.
 * @returns {Promise<{ code: string }>} The preprocessed code.
 */
export const preprocess = (code) => Promise.resolve({ code })
