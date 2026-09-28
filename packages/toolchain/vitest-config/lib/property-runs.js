import { isCI } from './env.js'

const mutationWorkerMarker = 'STRYKER_WORKER_DIR'
const mutationWorkerRuns = 30
const mutationWorkerSeed = 1

const isMutationWorker = typeof process !== 'undefined' && process.env[mutationWorkerMarker] !== undefined

export const propertyCheck = isMutationWorker
  ? { runs: mutationWorkerRuns, seed: mutationWorkerSeed }
  : { runs: isCI ? 1000 : 100 }
