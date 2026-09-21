import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as S from 'effect/Schema'
import * as TestClock from 'effect/testing/TestClock'
import * as Arbitrary from 'effect/unstable/arbitrary/Arbitrary'
import { describe, expect, it } from 'vitest'

import { type DrainOutcome, drainRegistry } from '../vm-harness/drain.js'
import { type EffectVitestIt, makeEffectMethods } from '../vm-harness/effect-adapter.js'
import { createHarnessApi, createRegistry, type TestRegistry } from '../vm-harness/registry.js'

interface HarnessedRun {
  readonly outcome: DrainOutcome
  readonly plan: ReadonlyArray<{ readonly fullName: string }>
}

const harnessWith = async (register: (methods: EffectVitestIt) => void): Promise<HarnessedRun> => {
  const registry: TestRegistry = createRegistry()
  registry.files.current = 'suite.test.ts'
  const api = createHarnessApi(registry)
  register(makeEffectMethods({ api: api.it, describe: api.describe, hooks: api.hooks, tests: registry.tests }))
  const outcome = await drainRegistry(registry, 1000)
  const plan = registry.tests.map((test) => ({
    fullName: [...test.suiteIds.map((id) => registry.suites.get(id)?.name ?? ''), test.name].join(' > '),
  }))
  return { outcome, plan }
}

const recordOf = (outcome: DrainOutcome, fullName: string) => {
  expect(outcome.kind).toBe('complete')
  if (outcome.kind !== 'complete') {
    throw new Error(`the drain timed out before ${fullName}`)
  }
  return outcome.tests.find((test) => test.fullName === fullName)
}

class TestService extends Context.Service<TestService, { readonly value: number }>()('@systemfsoftware/test/Service') {}

describe('vm effect adapter', () => {
  it('runs an it.effect test and reports its outcome', async () => {
    const { outcome } = await harnessWith((it) => {
      it.effect('passes', () => Effect.void)
      it.effect('fails', () => Effect.fail(new Error('the effect refused')))
    })
    expect(recordOf(outcome, 'passes')?.status).toBe('success')
    const failed = recordOf(outcome, 'fails')
    expect(failed?.status).toBe('failed')
    expect(failed?.failureMessage).toContain('the effect refused')
  })

  it('provides the test environment so TestClock adjustments complete', async () => {
    const { outcome } = await harnessWith((it) => {
      it.effect('advances the test clock', () =>
        Effect.gen(function*() {
          yield* TestClock.adjust(Duration.seconds(5))
        }))
    })
    expect(recordOf(outcome, 'advances the test clock')?.status).toBe('success')
  })

  it('injects layer services and closes the scope after all tests', async () => {
    const events: string[] = []
    const layer = Layer.effect(
      TestService,
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push('acquired')
          return { value: 42 }
        }),
        () =>
          Effect.sync(() => {
            events.push('released')
          }),
      ),
    )
    const { outcome } = await harnessWith((it) => {
      it.layer(layer)('with a service', ({ effect }) => {
        effect('reads the service', () =>
          Effect.map(TestService, (service) => {
            expect(service.value).toBe(42)
          }))
      })
    })
    expect(recordOf(outcome, 'with a service > reads the service')?.status).toBe('success')
    expect(events).toEqual(['acquired', 'released'])
  })

  it('maps a falsified property to a failed test naming the falsified value', async () => {
    const { outcome } = await harnessWith((it) => {
      it.effect.prop(
        'labels are never b',
        [Arbitrary.schema(S.Literals(['a', 'b']))],
        (values) => Effect.succeed((values as ReadonlyArray<string>)[0] !== 'b'),
      )
    })
    const falsified = recordOf(outcome, 'labels are never b')
    expect(falsified?.status).toBe('failed')
    expect(falsified?.failureMessage).toContain('b')
  })

  it('passes a truthy property as a success', async () => {
    const { outcome } = await harnessWith((it) => {
      it.effect.prop(
        'numbers stay numbers',
        [Arbitrary.schema(S.Number)],
        (values) => Effect.succeed(typeof (values as ReadonlyArray<unknown>)[0] === 'number'),
      )
    })
    expect(recordOf(outcome, 'numbers stay numbers')?.status).toBe('success')
  })

  it('names each row when the adapter drives the loop', async () => {
    const { plan } = await harnessWith((it) => {
      it.effect.each([[1], [2]])('row case', (row) => Effect.succeed(row))
    })
    expect(plan.map((planned) => planned.fullName)).toEqual(['row case [0]', 'row case [1]'])
  })

  it('skips through the adapter variants', async () => {
    const { outcome } = await harnessWith((it) => {
      it.effect.skip('not today', () => Effect.void)
      it.effect('stays', () => Effect.void)
    })
    expect(recordOf(outcome, 'not today')?.status).toBe('skipped')
    expect(recordOf(outcome, 'stays')?.status).toBe('success')
  })

  it('retries flaky effects until they pass', async () => {
    let attempts = 0
    const { outcome } = await harnessWith((it) => {
      it.effect('flaky but recoverable', () =>
        it.flakyTest(
          Effect.suspend(() => {
            attempts += 1
            return attempts < 3 ? Effect.fail(new Error('not yet')) : Effect.void
          }),
        ))
    })
    expect(recordOf(outcome, 'flaky but recoverable')?.status).toBe('success')
    expect(attempts).toBe(3)
  })
})
