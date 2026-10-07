import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import type * as Types from 'effect/Types'
import { afterAll, afterEach, beforeAll, beforeEach, inject, RunnerTestCase } from 'vitest'

const globalNamespace = inject('globalNamespace') as '__stryker__' | '__stryker2__'
const mutantActivation = inject('mutantActivation') as 'runtime' | 'static' | undefined
const mode = inject('mode') as 'dry-run' | 'mutant'

const ns: Types.Mutable<Instrument.InstrumenterContext> = globalThis[globalNamespace] ??
  (globalThis[globalNamespace] = {})

interface SuiteWithTaskMeta {
  meta: {
    hitCount?: number
    mutantCoverage?: Mutant.MutantCoverage
    testFileModules?: string[]
  }
}

ns.hitLimit = inject('hitLimit')

const evaluatedModuleKeysOf = (): string[] | undefined => {
  const workerState = Reflect.get(globalThis, '__vitest_worker__')
  if (typeof workerState !== 'object' || workerState === null) return undefined
  const info = 'moduleExecutionInfo' in workerState ? workerState.moduleExecutionInfo : undefined
  if (!(info instanceof Map)) return undefined
  return [...info.keys()].filter((key): key is string => typeof key === 'string' && !key.startsWith('node:'))
}

const registerMutantRunHooks = () => {
  beforeAll(() => {
    ns.hitCount = 0
  })

  Match.value(mutantActivation).pipe(
    Match.when('static', () => {
      ns.activeMutant = inject('activeMutant')
    }),
    Match.orElse(() =>
      beforeAll(() => {
        ns.activeMutant = inject('activeMutant')
      })
    ),
  )

  afterAll(({}, suite: SuiteWithTaskMeta) => {
    suite.meta.hitCount = ns.hitCount
  })
}

const registerDryRunHooks = () => {
  ns.activeMutant = undefined

  beforeEach(({ task }) => {
    ns.currentTestId = toRawTestId(task)
  })

  afterEach(() => {
    ns.currentTestId = undefined
  })

  afterAll(({}, suite: SuiteWithTaskMeta) => {
    suite.meta.mutantCoverage = ns.mutantCoverage
    const evaluatedModules = evaluatedModuleKeysOf()
    if (evaluatedModules !== undefined) {
      suite.meta.testFileModules = evaluatedModules
    }
  })
}

Match.value(mode).pipe(Match.when('mutant', registerMutantRunHooks), Match.orElse(registerDryRunHooks))

function toRawTestId(test: RunnerTestCase): string {
  return `${test.file.filepath}#${test.fullTestName}`
}
