import { isCI } from './env.js'

// Set by the worker launcher (packages/stryker-js/src/platform/node.ts), so a
// process carrying it is replaying one package's suite once per mutant, where
// the budget buys wall clock instead of confidence: the coverage run that
// precedes mutation already proved the suite.
const mutationWorkerMarker = 'STRYKER_WORKER_DIR'

/** @type {Record<string, string | undefined>} */
const env = typeof process === 'undefined' ? {} : process.env

export const propertyRuns = env[mutationWorkerMarker] !== undefined ? 30 : isCI ? 1000 : 100
