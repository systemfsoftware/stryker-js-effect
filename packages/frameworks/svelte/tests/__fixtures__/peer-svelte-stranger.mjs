import manifest from '../../package.json' with { type: 'json' }

export const VERSION = manifest.devDependencies.svelte

export const parse = 1
