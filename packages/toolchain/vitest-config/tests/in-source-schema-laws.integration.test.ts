import { describe, it } from '@systemfsoftware/vitest'
import { inSourceSchemaLaws } from '@systemfsoftware/vitest-config/schema-laws'
import * as Effect from 'effect/Effect'
import { relative } from 'node:path'
import { createVitest } from 'vitest/node'
import type { Reporter, TestModule } from 'vitest/node'

const fixtureRoot = decodeURIComponent(new URL('fixtures/in-source-laws/', import.meta.url).pathname)

const outcomesOf = (module: TestModule): ReadonlyArray<string> =>
  [...module.children.allTests()].map((test) => `${test.name}: ${test.result().state}`)

const runFixture = async (): Promise<Readonly<Record<string, ReadonlyArray<string>>>> => {
  const byModule: Record<string, string[]> = {}
  const recordEveryRun: Reporter = {
    onTestModuleEnd: (module) => {
      const key = relative(fixtureRoot, module.moduleId)
      byModule[key] = [...(byModule[key] ?? []), ...outcomesOf(module)].toSorted()
    },
  }
  const vitest = await createVitest(
    {
      root: fixtureRoot,
      config: false,
      watch: false,
      include: ['src/**/*.test.ts'],
      includeSource: ['src/**/*.ts'],
      reporters: [recordEveryRun],
    },
    { plugins: [inSourceSchemaLaws()] },
  )
  try {
    await vitest.start()
    return byModule
  } finally {
    await vitest.close()
  }
}

const fixtureRun = runFixture()
const outcomesByModule = Effect.promise(() => fixtureRun)

describe('inSourceSchemaLaws', () => {
  it("runs each exported schema's round-trip laws in its own module and nowhere else", function*({ expect }) {
    const byModule = yield* outcomesByModule
    yield* expect({ pair: byModule['src/pair.schema.ts'], consumer: byModule['src/consumer.test.ts'] }).toEqual({
      pair: ['∀x_AlphaEnc_=x: passed', '∀x_Alpha_=x: passed', '∀x_BetaEnc_=x: passed', '∀x_Beta_=x: passed'],
      consumer: ['declares a count field: passed'],
    })
  })

  it('collects a module with its own in-source block once, with both suites', function*({ expect }) {
    const byModule = yield* outcomesByModule
    yield* expect(byModule['src/refined.schema.ts']).toEqual([
      '∀n_Gamma_⊭Fraction: passed',
      '∀x_GammaEnc_=x: passed',
      '∀x_Gamma_=x: passed',
    ])
  })

  it('materializes a declared recursion budget so the recursion laws pass', function*({ expect }) {
    const byModule = yield* outcomesByModule
    yield* expect(byModule['src/expr.schema.ts']).toEqual([
      '∀s_ExprDeepShare_≠Zero: passed',
      '∀s_ExprVariants_⊇Declared: passed',
      '∀v_Expr_DepthPlusOne: passed',
      '∀x_ExprEnc_=x: passed',
      '∀x_ExprNesting_≤MaxDepth1: passed',
      '∀x_Expr_=x: passed',
    ])
  })

  it('makes a test entry of exactly the modules that export a schema or are test files', function*({ expect }) {
    const byModule = yield* outcomesByModule
    yield* expect(Object.keys(byModule).toSorted()).toEqual([
      'src/consumer.test.ts',
      'src/expr.schema.ts',
      'src/pair.schema.ts',
      'src/refined.schema.ts',
    ])
  })
})
