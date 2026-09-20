// AGENT outranks CI. This repo's agent shell sets both, so a CI-first reading
// gives every agent run the thorough forge treatment - tenfold property draws
// and coverage - for work that wants fast feedback. An agent run is a dev run.
//
// Presence, not equality: GitHub Actions writes "true" and the agent shell
// writes "1", so testing against either value classifies the other as local.
//
// Shared with ./setup.js, which vitest loads into the test environment, where
// `process` may be absent (browser mode).
/** @type {Record<string, string | undefined>} */
const env = typeof process === 'undefined' ? {} : process.env

export const isAgent = env['AGENT'] !== undefined

export const isCI = !isAgent && typeof env['CI'] === 'string' && env['CI'].length > 0
