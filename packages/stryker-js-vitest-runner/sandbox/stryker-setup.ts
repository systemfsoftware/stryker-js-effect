import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Match from 'effect/Match'
import type * as Types from 'effect/Types'
import { afterAll, afterEach, beforeAll, beforeEach, inject, RunnerTestCase } from 'vitest'

const globalNamespace = inject('globalNamespace') as '__stryker__' | '__stryker2__'
const mutantActivation = inject('mutantActivation') as 'runtime' | 'static' | undefined
const mode = inject('mode') as 'dry-run' | 'mutant'

const ns: Types.Mutable<Mutant.InstrumenterContext> = globalThis[globalNamespace] ?? (globalThis[globalNamespace] = {})

interface SuiteWithTaskMeta {
  meta: { hitCount?: number; mutantCoverage?: Mutant.MutantCoverage }
}

ns.hitLimit = inject('hitLimit')

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
  })
}

Match.value(mode).pipe(Match.when('mutant', registerMutantRunHooks), Match.orElse(registerDryRunHooks))

function toRawTestId(test: RunnerTestCase): string {
  return `${test.file.filepath}#${test.fullTestName}`
}
