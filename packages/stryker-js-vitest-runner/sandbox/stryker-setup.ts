import type { InstrumenterContext, MutantCoverage } from '@systemfsoftware/stryker-js-instrumenter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Types from 'effect/Types'
import { afterAll, afterEach, beforeAll, beforeEach, inject, RunnerTestCase, RunnerTestSuite } from 'vitest'

const globalNamespace = inject('globalNamespace') as '__stryker__' | '__stryker2__'
const mutantActivation = inject('mutantActivation') as 'runtime' | 'static' | undefined
const mode = inject('mode') as 'dry-run' | 'mutant'

const ns: Types.Mutable<InstrumenterContext> = globalThis[globalNamespace] ?? (globalThis[globalNamespace] = {})

interface SuiteWithTaskMeta {
  meta: { hitCount?: number; mutantCoverage?: MutantCoverage }
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
      })),
  )

  afterAll((_hookContext, suite: SuiteWithTaskMeta) => {
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

  afterAll((_hookContext, suite: SuiteWithTaskMeta) => {
    suite.meta.mutantCoverage = ns.mutantCoverage
  })
}

Match.value(mode).pipe(Match.when('mutant', registerMutantRunHooks), Match.orElse(registerDryRunHooks))

const suiteNames = (suite: RunnerTestSuite | undefined): readonly string[] =>
  Option.match(Option.fromNullishOr(suite), {
    onNone: () => [],
    onSome: (current) => [...suiteNames(current.suite), current.name],
  })

const collectTestName = ({ name, suite }: { readonly name: string; readonly suite?: RunnerTestSuite }): string =>
  [...suiteNames(suite), name].join(' ').trim()

function toRawTestId(test: RunnerTestCase): string {
  return `${test.file.filepath}#${collectTestName(test)}`
}
