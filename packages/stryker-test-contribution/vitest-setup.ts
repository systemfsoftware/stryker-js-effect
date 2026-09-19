import { FastCheck as fc } from 'effect/testing'

const isStrykerWorker = typeof process !== 'undefined' && process.env['STRYKER_MUTATOR_WORKER'] !== undefined
const isCi = typeof process !== 'undefined' && process.env['CI'] === 'true'

const numRunsOf = (strykerWorker: boolean, ci: boolean): number => {
  if (strykerWorker) {
    return 30
  }
  if (ci) {
    return 1000
  }
  return 100
}

const numRuns = numRunsOf(isStrykerWorker, isCi)

fc.configureGlobal({ numRuns })
